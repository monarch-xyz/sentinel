import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/index.ts";

// Mock ioredis first (before bullmq)
vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    quit: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn(),
    on: vi.fn(),
  })),
}));

// Mock BullMQ
const mockQueueAdd = vi.fn().mockResolvedValue({ id: "job-id" });
const mockUpsertJobScheduler = vi.fn().mockResolvedValue({ id: "scheduler-job" });

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    upsertJobScheduler: mockUpsertJobScheduler,
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("../../src/db/index.ts", () => ({
  pool: {
    query: vi.fn(),
  },
}));

describe("Scheduler Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queueActiveSignals adds active signals to the evaluation queue", async () => {
    // 1. Mock DB response with 2 active signals
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ id: "signal-1" }, { id: "signal-2" }],
    });

    // 2. Import and call queueActiveSignals
    const { queueActiveSignals } = await import("../../src/worker/scheduler.ts");
    const count = await queueActiveSignals();

    // 3. Verify
    expect(count).toBe(2);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("WHERE is_active = true"));
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "evaluate",
      { signalId: "signal-1" },
      expect.objectContaining({ jobId: "signal-1" }),
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "evaluate",
      { signalId: "signal-2" },
      expect.objectContaining({ jobId: "signal-2" }),
    );
  });

  it("startScheduler registers a repeatable job", async () => {
    const { startScheduler } = await import("../../src/worker/scheduler.ts");
    await startScheduler();

    expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
      "signal-scheduler",
      expect.objectContaining({
        every: 30000,
      }),
      expect.objectContaining({
        name: "check-signals",
        data: {},
      }),
    );
  });
});
