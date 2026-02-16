import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatableSignal } from "./condition.js";
import { findFirstTrigger, simulateSignal, simulateSignalOverTime } from "./simulation.js";

// Mock block resolution
vi.mock("../envio/blocks.js", () => ({
  resolveBlockByTimestamp: vi.fn(),
}));

vi.mock("../rpc/index.js", () => ({
  readMarket: vi.fn(),
  readMarketAtBlock: vi.fn(),
  readPosition: vi.fn(),
  readPositionAtBlock: vi.fn(),
}));

import { resolveBlockByTimestamp } from "../envio/blocks.js";
import { readMarketAtBlock } from "../rpc/index.js";
import type { EventFetcher } from "./fetcher.js";
import { createMorphoFetcher } from "./morpho-fetcher.js";

// Type the mocked functions
const mockedResolveBlockByTimestamp = vi.mocked(resolveBlockByTimestamp);
const mockedReadMarketAtBlock = vi.mocked(readMarketAtBlock);

describe("simulation", () => {
  type FetchEventsFn = EventFetcher["fetchEvents"];
  const mockEventFetcher: EventFetcher & {
    fetchEvents: ReturnType<typeof vi.fn<FetchEventsFn>>;
  } = {
    fetchEvents: vi.fn<FetchEventsFn>(),
  };

  const createFetcher = (chainId: number) => createMorphoFetcher(mockEventFetcher, { chainId });

  const createMarketResult = (overrides: Record<string, bigint> = {}) => ({
    totalSupplyAssets: 0n,
    totalSupplyShares: 0n,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
    lastUpdate: 0n,
    fee: 0n,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create a test signal
  const createTestSignal = (overrides: Partial<EvaluatableSignal> = {}): EvaluatableSignal => ({
    id: "test-signal-1",
    name: "Test Signal",
    description: "A test signal",
    chains: [1],
    window: { duration: "1d" },
    condition: {
      type: "condition",
      left: {
        type: "state",
        entity_type: "Market",
        filters: [{ field: "marketId", op: "eq", value: "test-market" }],
        field: "totalBorrowAssets",
      },
      operator: "gt",
      right: {
        type: "constant",
        value: 1000000,
      },
    },
    webhook_url: "https://example.com/webhook",
    cooldown_minutes: 60,
    is_active: true,
    ...overrides,
  });

  describe("simulateSignal", () => {
    it("should return triggered=true when condition is met", async () => {
      const signal = createTestSignal();
      const atTimestamp = Date.now();
      const chainId = 1;
      const fetcher = createFetcher(chainId);

      // Mock block resolution
      mockedResolveBlockByTimestamp
        .mockResolvedValueOnce(18000000) // current block
        .mockResolvedValueOnce(17990000) // window start block
        .mockResolvedValue(17990000);

      mockedReadMarketAtBlock.mockResolvedValue(
        createMarketResult({ totalBorrowAssets: 2000000n }),
      );

      const result = await simulateSignal({ signal, atTimestamp, chainId, fetcher });

      expect(result.triggered).toBe(true);
      expect(result.leftValue).toBe(2000000);
      expect(result.rightValue).toBe(1000000);
      expect(result.operator).toBe("gt");
      expect(result.evaluatedAt).toBe(atTimestamp);
      expect(result.blockNumbers.current).toBe(18000000);
      expect(result.blockNumbers.windowStart).toBe(17990000);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should return triggered=false when condition is not met", async () => {
      const signal = createTestSignal();
      const atTimestamp = Date.now();
      const chainId = 1;
      const fetcher = createFetcher(chainId);

      mockedResolveBlockByTimestamp
        .mockResolvedValueOnce(18000000)
        .mockResolvedValueOnce(17990000)
        .mockResolvedValue(17990000);

      mockedReadMarketAtBlock.mockResolvedValue(createMarketResult({ totalBorrowAssets: 500000n }));

      const result = await simulateSignal({ signal, atTimestamp, chainId, fetcher });

      expect(result.triggered).toBe(false);
      expect(result.leftValue).toBe(500000);
      expect(result.rightValue).toBe(1000000);
    });

    it("should calculate correct window start from duration", async () => {
      const signal = createTestSignal({
        window: { duration: "7d" }, // 7 days
      });
      const atTimestamp = 1704067200000; // 2024-01-01 00:00:00 UTC
      const chainId = 1;
      const fetcher = createFetcher(chainId);
      const expectedWindowStart = atTimestamp - 7 * 24 * 60 * 60 * 1000;

      mockedResolveBlockByTimestamp
        .mockResolvedValueOnce(18000000)
        .mockResolvedValueOnce(17900000)
        .mockResolvedValue(17900000);
      mockedReadMarketAtBlock.mockResolvedValue(createMarketResult({ totalBorrowAssets: 0n }));

      const result = await simulateSignal({ signal, atTimestamp, chainId, fetcher });

      expect(result.windowStart).toBe(expectedWindowStart);
      // Check that resolveBlockByTimestamp was called with correct timestamps
      expect(resolveBlockByTimestamp).toHaveBeenCalledWith(chainId, atTimestamp);
      expect(resolveBlockByTimestamp).toHaveBeenCalledWith(chainId, expectedWindowStart);
    });

    it("should handle state queries with window_start snapshot", async () => {
      const signal = createTestSignal({
        condition: {
          type: "condition",
          left: {
            type: "state",
            entity_type: "Market",
            filters: [{ field: "marketId", op: "eq", value: "test-market" }],
            field: "totalBorrowAssets",
            snapshot: "window_start", // Query at window start
          },
          operator: "gt",
          right: {
            type: "constant",
            value: 1000000,
          },
        },
      });

      const atTimestamp = 1704067200000;
      const chainId = 1;
      const fetcher = createFetcher(chainId);

      mockedResolveBlockByTimestamp
        .mockResolvedValueOnce(18000000) // current
        .mockResolvedValueOnce(17990000) // window start (for context)
        .mockResolvedValueOnce(17990000) // window start (for state query)
        .mockResolvedValue(17990000);
      mockedReadMarketAtBlock.mockResolvedValue(
        createMarketResult({ totalBorrowAssets: 1500000n }),
      );

      const result = await simulateSignal({ signal, atTimestamp, chainId, fetcher });

      expect(result.triggered).toBe(true);
    });

    it("should handle event aggregation queries", async () => {
      const signal = createTestSignal({
        condition: {
          type: "condition",
          left: {
            type: "event",
            event_type: "Borrow",
            filters: [{ field: "marketId", op: "eq", value: "test-market" }],
            field: "assets",
            aggregation: "sum",
          },
          operator: "gte",
          right: {
            type: "constant",
            value: 500000,
          },
        },
      });

      const atTimestamp = 1704067200000;
      const chainId = 1;
      const fetcher = createFetcher(chainId);
      const windowStart = atTimestamp - 24 * 60 * 60 * 1000; // 1 day

      mockedResolveBlockByTimestamp
        .mockResolvedValueOnce(18000000)
        .mockResolvedValueOnce(17990000)
        .mockResolvedValue(17990000);
      mockEventFetcher.fetchEvents.mockResolvedValue(750000);

      const result = await simulateSignal({ signal, atTimestamp, chainId, fetcher });

      expect(result.triggered).toBe(true);
      expect(result.leftValue).toBe(750000);
      expect(mockEventFetcher.fetchEvents).toHaveBeenCalledWith(
        expect.objectContaining({ type: "event", event_type: "Borrow" }),
        windowStart,
        atTimestamp,
      );
    });

    it("should handle complex expressions with math operators", async () => {
      const signal = createTestSignal({
        condition: {
          type: "condition",
          left: {
            type: "expression",
            operator: "div",
            left: {
              type: "state",
              entity_type: "Market",
              filters: [{ field: "marketId", op: "eq", value: "test-market" }],
              field: "totalBorrowAssets",
            },
            right: {
              type: "state",
              entity_type: "Market",
              filters: [{ field: "marketId", op: "eq", value: "test-market" }],
              field: "totalSupplyAssets",
            },
          },
          operator: "gt",
          right: {
            type: "constant",
            value: 0.9, // 90% utilization threshold
          },
        },
      });

      const atTimestamp = Date.now();
      const chainId = 1;
      const fetcher = createFetcher(chainId);

      mockedResolveBlockByTimestamp
        .mockResolvedValueOnce(18000000)
        .mockResolvedValueOnce(17990000)
        .mockResolvedValue(17990000);

      mockedReadMarketAtBlock.mockResolvedValue(
        createMarketResult({ totalBorrowAssets: 950000n, totalSupplyAssets: 1000000n }),
      );

      const result = await simulateSignal({ signal, atTimestamp, chainId, fetcher });

      expect(result.triggered).toBe(true);
      expect(result.leftValue).toBe(0.95); // 950000 / 1000000
      expect(result.rightValue).toBe(0.9);
    });

    it("should handle all comparison operators", async () => {
      const operators: Array<{
        op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
        left: number;
        right: number;
        expected: boolean;
      }> = [
        { op: "gt", left: 10, right: 5, expected: true },
        { op: "gt", left: 5, right: 10, expected: false },
        { op: "gte", left: 10, right: 10, expected: true },
        { op: "lt", left: 5, right: 10, expected: true },
        { op: "lte", left: 10, right: 10, expected: true },
        { op: "eq", left: 10, right: 10, expected: true },
        { op: "eq", left: 10, right: 5, expected: false },
        { op: "neq", left: 10, right: 5, expected: true },
        { op: "neq", left: 10, right: 10, expected: false },
      ];

      for (const { op, left, right, expected } of operators) {
        vi.clearAllMocks();
        const fetcher = createFetcher(1);

        const signal = createTestSignal({
          condition: {
            type: "condition",
            left: { type: "constant", value: left },
            operator: op,
            right: { type: "constant", value: right },
          },
        });

        mockedResolveBlockByTimestamp
          .mockResolvedValueOnce(18000000)
          .mockResolvedValueOnce(17990000)
          .mockResolvedValue(17990000);

        const result = await simulateSignal({
          signal,
          atTimestamp: Date.now(),
          chainId: 1,
          fetcher,
        });

        expect(result.triggered).toBe(expected);
        expect(result.operator).toBe(op);
      }
    });
  });

  describe("simulateSignalOverTime", () => {
    it("should return results for each time step", async () => {
      const signal = createTestSignal({
        condition: {
          type: "condition",
          left: { type: "constant", value: 10 },
          operator: "gt",
          right: { type: "constant", value: 5 },
        },
      });

      mockedResolveBlockByTimestamp.mockResolvedValue(18000000);

      const startTimestamp = 1704067200000;
      const endTimestamp = startTimestamp + 3 * 3600000; // 3 hours
      const stepMs = 3600000; // 1 hour
      const fetcher = createFetcher(1);

      const results = await simulateSignalOverTime(
        signal,
        1,
        startTimestamp,
        endTimestamp,
        stepMs,
        fetcher,
      );

      expect(results).toHaveLength(4); // 0, 1, 2, 3 hours
      expect(results[0].evaluatedAt).toBe(startTimestamp);
      expect(results[1].evaluatedAt).toBe(startTimestamp + 3600000);
      expect(results[2].evaluatedAt).toBe(startTimestamp + 7200000);
      expect(results[3].evaluatedAt).toBe(startTimestamp + 10800000);
    });
  });

  describe("findFirstTrigger", () => {
    it("should return null if signal never triggers in range", async () => {
      const signal = createTestSignal({
        condition: {
          type: "condition",
          left: { type: "constant", value: 5 },
          operator: "gt",
          right: { type: "constant", value: 10 }, // Never true
        },
      });

      mockedResolveBlockByTimestamp.mockResolvedValue(18000000);
      const fetcher = createFetcher(1);

      const result = await findFirstTrigger(
        signal,
        1,
        1704067200000,
        1704153600000,
        60000,
        fetcher,
      );

      expect(result).toBeNull();
    });

    it("should return start if signal triggers from start", async () => {
      const signal = createTestSignal({
        condition: {
          type: "condition",
          left: { type: "constant", value: 10 },
          operator: "gt",
          right: { type: "constant", value: 5 }, // Always true
        },
      });

      mockedResolveBlockByTimestamp.mockResolvedValue(18000000);
      const fetcher = createFetcher(1);

      const startTimestamp = 1704067200000;
      const result = await findFirstTrigger(
        signal,
        1,
        startTimestamp,
        1704153600000,
        60000,
        fetcher,
      );

      expect(result).not.toBeNull();
      expect(result?.evaluatedAt).toBe(startTimestamp);
      expect(result?.triggered).toBe(true);
    });

    it("should find transition point using binary search", async () => {
      // Test that binary search converges to a trigger point
      // Each simulateSignal call makes 2 fetchState calls (evaluateNode + evaluateCondition)
      const signal = createTestSignal();

      const startTimestamp = 1704067200000;
      const endTimestamp = 1704153600000;

      mockedResolveBlockByTimestamp.mockResolvedValue(18000000);
      const fetcher = createFetcher(1);

      // Track simulation calls (each simulateSignal = 2 fetchState calls)
      let simulationIndex = 0;

      mockedReadMarketAtBlock.mockImplementation(async () => {
        // Each simulation increments twice, so divide by 2 to get simulation number
        const simNum = Math.floor(simulationIndex / 2);
        simulationIndex++;

        // Simulation 0 = end check → should trigger
        // Simulation 1 = start check → should NOT trigger
        // Simulation 2+ = binary search → all trigger to converge quickly
        if (simNum === 0) return createMarketResult({ totalBorrowAssets: 2000000n }); // End triggers
        if (simNum === 1) return createMarketResult({ totalBorrowAssets: 500000n }); // Start doesn't trigger
        return createMarketResult({ totalBorrowAssets: 2000000n }); // Binary search finds triggers
      });

      const result = await findFirstTrigger(
        signal,
        1,
        startTimestamp,
        endTimestamp,
        60000,
        fetcher,
      );

      // Should find a trigger point
      expect(result).not.toBeNull();
      expect(result?.triggered).toBe(true);
    });
  });
});
