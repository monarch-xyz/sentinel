import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/index.js";
import { dispatchNotification } from "../../src/worker/notifier.js";

// Mock ioredis first (before bullmq)
vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    quit: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn(),
    on: vi.fn(),
  })),
}));

// Mock everything
vi.mock("../../src/db/index.js", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../../src/envio/client.js", () => ({
  EnvioClient: vi.fn().mockImplementation(() => ({
    fetchState: vi.fn(),
    fetchEvents: vi.fn(),
  })),
}));

// Mock the evaluator to return triggered=true
vi.mock("../../src/engine/condition.js", () => ({
  SignalEvaluator: vi.fn().mockImplementation(() => ({
    evaluate: vi.fn().mockResolvedValue({ triggered: true, timestamp: Date.now() }),
  })),
}));

vi.mock("../../src/worker/notifier.js", () => ({
  dispatchNotification: vi.fn().mockResolvedValue({ success: true, status: 200, durationMs: 100 }),
}));

// Type for BullMQ job handler
type JobHandler = (job: { data: { signalId: string } }) => Promise<void>;

// We mock BullMQ to capture the worker handler
let capturedHandler: JobHandler | undefined;
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
  Worker: vi.fn().mockImplementation((_name: string, handler: JobHandler) => {
    capturedHandler = handler;
    return { on: vi.fn(), close: vi.fn() };
  }),
}));

// Type the mocked pool
const mockedPoolQuery = vi.mocked(pool.query);

describe("Processor Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates a signal and dispatches notification", async () => {
    const { setupWorker } = await import("../../src/worker/processor.js");
    setupWorker();

    // 1. Mock DB returning a simple signal
    mockedPoolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "sig-123",
            name: "Simple Alert",
            is_active: true,
            webhook_url: "https://test.com",
            cooldown_minutes: 5,
            last_triggered_at: null,
            definition: {
              version: 1,
              dsl: {
                scope: { chains: [1] },
                window: { duration: "1h" },
                conditions: [
                  {
                    type: "threshold",
                    metric: "Morpho.Position.supplyShares",
                    operator: ">",
                    value: 100,
                    chain_id: 1,
                    market_id: "0xmarket",
                    address: "0xuser",
                  },
                ],
              },
              ast: {
                chains: [1],
                window: { duration: "1h" },
                conditions: [
                  {
                    type: "condition",
                    operator: "gt",
                    left: { type: "constant", value: 100 },
                    right: { type: "constant", value: 50 },
                  },
                ],
                logic: "AND",
              },
            },
          },
        ],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      })
      .mockResolvedValue({ rows: [], command: "UPDATE", rowCount: 0, oid: 0, fields: [] }); // For subsequent UPDATE queries

    // 2. Execute the worker handler
    if (!capturedHandler) throw new Error("Handler not captured");
    await capturedHandler({ data: { signalId: "sig-123" } });

    // 3. Verify notification was sent (because evaluator returns triggered=true)
    expect(dispatchNotification).toHaveBeenCalledWith(
      "https://test.com",
      expect.objectContaining({ signal_id: "sig-123" }),
    );

    // 4. Verify DB was updated
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE signals SET last_triggered_at"),
      ["sig-123"],
    );
  });
});
