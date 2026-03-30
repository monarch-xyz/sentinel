import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignalEvaluator } from "../../src/engine/condition.ts";
import type { EventFetcher } from "../../src/engine/fetcher.ts";
import { createMorphoFetcher } from "../../src/engine/morpho-fetcher.ts";
import { resolveBlockByTimestamp } from "../../src/envio/blocks.ts";
import { executeArchiveRpcCall } from "../../src/rpc/index.ts";
import type { Signal } from "../../src/types/index.ts";

vi.mock("../../src/envio/blocks.js", () => ({
  resolveBlockByTimestamp: vi.fn(),
}));

vi.mock("../../src/rpc/index.js", () => ({
  executeArchiveRpcCall: vi.fn(),
}));

describe("SignalEvaluator RPC historical state", () => {
  const MARKET_ID = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const USER = "0x2222222222222222222222222222222222222222" as const;
  const mockedResolveBlockByTimestamp = vi.mocked(resolveBlockByTimestamp);
  const mockedExecuteArchiveRpcCall = vi.mocked(executeArchiveRpcCall);

  const eventFetcher: EventFetcher = {
    fetchEvents: vi.fn().mockResolvedValue(0),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates change-style condition using current and historical RPC state", async () => {
    const now = Date.now();
    const signal: Signal = {
      id: "rpc-change-test",
      name: "RPC Change Condition",
      chains: [1],
      window: { duration: "7d" },
      conditions: [
        {
          type: "condition",
          left: {
            type: "state",
            protocol: "morpho",
            entity_type: "Position",
            filters: [
              { field: "marketId", op: "eq", value: MARKET_ID },
              { field: "user", op: "eq", value: USER },
            ],
            field: "supplyShares",
            snapshot: "current",
          },
          operator: "lt",
          right: {
            type: "expression",
            operator: "mul",
            left: {
              type: "state",
              protocol: "morpho",
              entity_type: "Position",
              filters: [
                { field: "marketId", op: "eq", value: MARKET_ID },
                { field: "user", op: "eq", value: USER },
              ],
              field: "supplyShares",
              snapshot: "window_start",
            },
            right: { type: "constant", value: 0.8 },
          },
        },
      ],
      webhook_url: "https://example.com/webhook",
      cooldown_minutes: 5,
      is_active: true,
    };

    mockedExecuteArchiveRpcCall
      .mockResolvedValueOnce([700n, 0n, 0n])
      .mockResolvedValueOnce([1000n, 0n, 0n]);
    mockedResolveBlockByTimestamp.mockResolvedValue(19005555);

    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });
      const evaluator = new SignalEvaluator(fetcher);
      const result = await evaluator.evaluate(signal);

      expect(result.triggered).toBe(true); // 700 < 0.8 * 1000
      expect(mockedResolveBlockByTimestamp).toHaveBeenCalledWith(1, now - 7 * 24 * 60 * 60 * 1000);
      expect(mockedExecuteArchiveRpcCall).toHaveBeenNthCalledWith(
        1,
        1,
        expect.objectContaining({
          signature: expect.stringContaining("position(bytes32 id, address user)"),
        }),
      );
      expect(mockedExecuteArchiveRpcCall).toHaveBeenNthCalledWith(
        2,
        1,
        expect.objectContaining({
          signature: expect.stringContaining("position(bytes32 id, address user)"),
        }),
        19005555n,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
