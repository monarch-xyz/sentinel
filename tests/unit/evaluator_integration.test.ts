import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignalEvaluator } from "../../src/engine/condition.js";
import type { DataFetcher } from "../../src/engine/fetcher.js";
import type { Signal } from "../../src/types/index.js";

// Mock block resolver to avoid real network calls
vi.mock("../../src/envio/blocks.js", () => {
  return {
    resolveBlockByTimestamp: vi.fn().mockResolvedValue(19000000), // Mock block number
  };
});

describe("SignalEvaluator Integration", () => {
  let evaluator: SignalEvaluator;
  let mockFetcher: DataFetcher;

  beforeEach(() => {
    mockFetcher = {
      fetchState: vi.fn(),
      fetchEvents: vi.fn(),
    };
    evaluator = new SignalEvaluator(mockFetcher);
  });

  it("correctly evaluates a complex signal (net supply change)", async () => {
    // Scenario: Net supply (Supply - Withdraw) < 20% of window_start position
    const signal: Signal = {
      id: "test-signal",
      name: "Net Supply Drop",
      chains: [1],
      window: { duration: "1h" },
      webhook_url: "https://mock.com",
      cooldown_minutes: 5,
      is_active: true,
      conditions: [
        {
          type: "condition",
          operator: "lt",
          left: {
            type: "expression",
            operator: "sub",
            left: {
              type: "event",
              event_type: "Supply",
              filters: [{ field: "user", op: "eq", value: "0x123" }],
              field: "assets",
              aggregation: "sum",
            },
            right: {
              type: "event",
              event_type: "Withdraw",
              filters: [{ field: "user", op: "eq", value: "0x123" }],
              field: "assets",
              aggregation: "sum",
            },
          },
          right: {
            type: "expression",
            operator: "mul",
            left: { type: "constant", value: 0.2 },
            right: {
              type: "state",
              entity_type: "Position",
              filters: [{ field: "user", op: "eq", value: "0x123" }],
              field: "supplyShares",
              snapshot: "window_start",
            },
          },
        },
      ],
    };

    // Setup Mock Data
    // window_start position = 1000
    mockFetcher.fetchState.mockResolvedValue(1000);
    // Net supply = 150 (Supply 200 - Withdraw 50)
    // Condition: 150 < (0.2 * 1000) => 150 < 200 => TRUE
    mockFetcher.fetchEvents
      .mockResolvedValueOnce(200) // Supply
      .mockResolvedValueOnce(50); // Withdraw

    const result = await evaluator.evaluate(signal);
    expect(result.triggered).toBe(true);
    expect(mockFetcher.fetchState).toHaveBeenCalledWith(expect.anything(), expect.any(Number));
  });

  it("returns false when condition is not met", async () => {
    const signal: Signal = {
      id: "test-fail",
      name: "Utilization Alert",
      chains: [1],
      window: { duration: "1h" },
      webhook_url: "https://mock.com",
      cooldown_minutes: 5,
      is_active: true,
      conditions: [
        {
          type: "condition",
          operator: "gt",
          left: { type: "constant", value: 50 },
          right: { type: "constant", value: 100 },
        },
      ],
    };

    const result = await evaluator.evaluate(signal);
    expect(result.triggered).toBe(false);
  });
});
