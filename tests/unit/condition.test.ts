import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignalEvaluator } from "../../src/engine/condition.js";
import { type EvalContext, evaluateCondition, evaluateNode } from "../../src/engine/evaluator.js";
import type { DataFetcher } from "../../src/engine/fetcher.js";
import type {
  ComparisonOp,
  Condition,
  EventRef,
  ExpressionNode,
  Signal,
  StateRef,
} from "../../src/types/index.js";

type FetchStateFn = (ref: StateRef, timestamp?: number) => Promise<number>;
type FetchEventsFn = (ref: EventRef, startTimeMs: number, endTimeMs: number) => Promise<number>;

// Mock the blocks module
vi.mock("../../src/envio/blocks.js", () => ({
  resolveBlockByTimestamp: vi.fn().mockResolvedValue(12345678),
}));

describe("evaluateCondition", () => {
  const mockContext: EvalContext = {
    chainId: 1,
    windowDuration: "1h",
    now: Date.now(),
    windowStart: Date.now() - 3600000,
    fetchState: vi.fn<FetchStateFn>(),
    fetchEvents: vi.fn<FetchEventsFn>(),
  };

  describe("comparison operators", () => {
    it("gt: returns true when left > right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 50 };
      const result = await evaluateCondition(left, "gt", right, mockContext);
      expect(result).toBe(true);
    });

    it("gt: returns false when left <= right", async () => {
      const left: ExpressionNode = { type: "constant", value: 50 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "gt", right, mockContext);
      expect(result).toBe(false);
    });

    it("gt: returns false when left equals right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "gt", right, mockContext);
      expect(result).toBe(false);
    });

    it("gte: returns true when left > right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 50 };
      const result = await evaluateCondition(left, "gte", right, mockContext);
      expect(result).toBe(true);
    });

    it("gte: returns true when left equals right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "gte", right, mockContext);
      expect(result).toBe(true);
    });

    it("gte: returns false when left < right", async () => {
      const left: ExpressionNode = { type: "constant", value: 50 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "gte", right, mockContext);
      expect(result).toBe(false);
    });

    it("lt: returns true when left < right", async () => {
      const left: ExpressionNode = { type: "constant", value: 50 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "lt", right, mockContext);
      expect(result).toBe(true);
    });

    it("lt: returns false when left >= right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 50 };
      const result = await evaluateCondition(left, "lt", right, mockContext);
      expect(result).toBe(false);
    });

    it("lt: returns false when left equals right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "lt", right, mockContext);
      expect(result).toBe(false);
    });

    it("lte: returns true when left < right", async () => {
      const left: ExpressionNode = { type: "constant", value: 50 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "lte", right, mockContext);
      expect(result).toBe(true);
    });

    it("lte: returns true when left equals right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "lte", right, mockContext);
      expect(result).toBe(true);
    });

    it("lte: returns false when left > right", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 50 };
      const result = await evaluateCondition(left, "lte", right, mockContext);
      expect(result).toBe(false);
    });

    it("eq: returns true when values are equal", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "eq", right, mockContext);
      expect(result).toBe(true);
    });

    it("eq: returns false when values are not equal", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 50 };
      const result = await evaluateCondition(left, "eq", right, mockContext);
      expect(result).toBe(false);
    });

    it("neq: returns true when values are not equal", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 50 };
      const result = await evaluateCondition(left, "neq", right, mockContext);
      expect(result).toBe(true);
    });

    it("neq: returns false when values are equal", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 100 };
      const result = await evaluateCondition(left, "neq", right, mockContext);
      expect(result).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles zero values correctly", async () => {
      const left: ExpressionNode = { type: "constant", value: 0 };
      const right: ExpressionNode = { type: "constant", value: 0 };

      expect(await evaluateCondition(left, "eq", right, mockContext)).toBe(true);
      expect(await evaluateCondition(left, "gte", right, mockContext)).toBe(true);
      expect(await evaluateCondition(left, "lte", right, mockContext)).toBe(true);
      expect(await evaluateCondition(left, "gt", right, mockContext)).toBe(false);
      expect(await evaluateCondition(left, "lt", right, mockContext)).toBe(false);
    });

    it("handles negative numbers correctly", async () => {
      const left: ExpressionNode = { type: "constant", value: -50 };
      const right: ExpressionNode = { type: "constant", value: -100 };

      expect(await evaluateCondition(left, "gt", right, mockContext)).toBe(true);
      expect(await evaluateCondition(left, "gte", right, mockContext)).toBe(true);
      expect(await evaluateCondition(left, "lt", right, mockContext)).toBe(false);
    });

    it("handles negative and positive comparison", async () => {
      const left: ExpressionNode = { type: "constant", value: -10 };
      const right: ExpressionNode = { type: "constant", value: 10 };

      expect(await evaluateCondition(left, "lt", right, mockContext)).toBe(true);
      expect(await evaluateCondition(left, "neq", right, mockContext)).toBe(true);
    });

    it("handles decimal values correctly", async () => {
      const left: ExpressionNode = { type: "constant", value: 0.1 };
      const right: ExpressionNode = { type: "constant", value: 0.2 };

      expect(await evaluateCondition(left, "lt", right, mockContext)).toBe(true);
    });

    it("handles very large numbers", async () => {
      const left: ExpressionNode = { type: "constant", value: 1e18 };
      const right: ExpressionNode = { type: "constant", value: 1e17 };

      expect(await evaluateCondition(left, "gt", right, mockContext)).toBe(true);
    });

    it("returns false for unknown operator", async () => {
      const left: ExpressionNode = { type: "constant", value: 100 };
      const right: ExpressionNode = { type: "constant", value: 50 };
      const result = await evaluateCondition(left, "unknown" as ComparisonOp, right, mockContext);
      expect(result).toBe(false);
    });
  });

  describe("with expressions", () => {
    it("evaluates complex expressions before comparing", async () => {
      const left: ExpressionNode = {
        type: "expression",
        operator: "add",
        left: { type: "constant", value: 50 },
        right: { type: "constant", value: 50 },
      };
      const right: ExpressionNode = { type: "constant", value: 100 };

      expect(await evaluateCondition(left, "eq", right, mockContext)).toBe(true);
    });

    it("evaluates nested expressions", async () => {
      const left: ExpressionNode = {
        type: "expression",
        operator: "mul",
        left: {
          type: "expression",
          operator: "add",
          left: { type: "constant", value: 2 },
          right: { type: "constant", value: 3 },
        },
        right: { type: "constant", value: 10 },
      };
      const right: ExpressionNode = { type: "constant", value: 50 };

      expect(await evaluateCondition(left, "eq", right, mockContext)).toBe(true);
    });
  });

  describe("with state refs", () => {
    it("fetches state and compares", async () => {
      const ctx: EvalContext = {
        ...mockContext,
        fetchState: vi.fn<FetchStateFn>().mockResolvedValue(1000),
      };

      const left: ExpressionNode = {
        type: "state",
        entity_type: "Position",
        filters: [{ field: "user", op: "eq", value: "0x123" }],
        field: "supplyShares",
      };
      const right: ExpressionNode = { type: "constant", value: 500 };

      const result = await evaluateCondition(left, "gt", right, ctx);
      expect(result).toBe(true);
      expect(ctx.fetchState).toHaveBeenCalled();
    });
  });

  describe("with event refs", () => {
    it("fetches events and compares", async () => {
      const ctx: EvalContext = {
        ...mockContext,
        fetchEvents: vi.fn<FetchEventsFn>().mockResolvedValue(2000),
      };

      const left: ExpressionNode = {
        type: "event",
        event_type: "Supply",
        filters: [{ field: "user", op: "eq", value: "0x123" }],
        field: "assets",
        aggregation: "sum",
      };
      const right: ExpressionNode = { type: "constant", value: 1000 };

      const result = await evaluateCondition(left, "gte", right, ctx);
      expect(result).toBe(true);
      expect(ctx.fetchEvents).toHaveBeenCalled();
    });
  });
});

interface MockDataFetcher extends DataFetcher {
  fetchState: ReturnType<typeof vi.fn<FetchStateFn>>;
  fetchEvents: ReturnType<typeof vi.fn<FetchEventsFn>>;
}

describe("SignalEvaluator", () => {
  let mockEnvioClient: MockDataFetcher;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnvioClient = {
      fetchState: vi.fn<FetchStateFn>().mockResolvedValue(1000),
      fetchEvents: vi.fn<FetchEventsFn>().mockResolvedValue(500),
    };
  });

  const createSignal = (condition: Condition, overrides: Partial<Signal> = {}): Signal => ({
    id: "test-signal-1",
    name: "Test Signal",
    chains: [1],
    window: { duration: "1h" },
    conditions: [condition],
    webhook_url: "https://example.com/webhook",
    cooldown_minutes: 5,
    is_active: true,
    ...overrides,
  });

  describe("evaluate", () => {
    it("returns triggered=true when condition is met", async () => {
      const signal = createSignal({
        type: "condition",
        left: { type: "constant", value: 100 },
        operator: "gt",
        right: { type: "constant", value: 50 },
      });

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);

      expect(result.signalId).toBe("test-signal-1");
      expect(result.triggered).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it("returns triggered=false when condition is not met", async () => {
      const signal = createSignal({
        type: "condition",
        left: { type: "constant", value: 50 },
        operator: "gt",
        right: { type: "constant", value: 100 },
      });

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);

      expect(result.triggered).toBe(false);
    });

    it("evaluates with state refs from envio client", async () => {
      mockEnvioClient.fetchState.mockResolvedValue(2000);

      const signal = createSignal({
        type: "condition",
        left: {
          type: "state",
          entity_type: "Position",
          filters: [{ field: "user", op: "eq", value: "0x123" }],
          field: "supplyShares",
        },
        operator: "gte",
        right: { type: "constant", value: 1000 },
      });

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);

      expect(result.triggered).toBe(true);
      expect(mockEnvioClient.fetchState).toHaveBeenCalled();
    });

    it("evaluates with event refs from envio client", async () => {
      mockEnvioClient.fetchEvents.mockResolvedValue(750);

      const signal = createSignal({
        type: "condition",
        left: {
          type: "event",
          event_type: "Supply",
          filters: [{ field: "user", op: "eq", value: "0x123" }],
          field: "assets",
          aggregation: "sum",
        },
        operator: "lt",
        right: { type: "constant", value: 1000 },
      });

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);

      expect(result.triggered).toBe(true);
      expect(mockEnvioClient.fetchEvents).toHaveBeenCalled();
    });

    it("handles complex expression conditions", async () => {
      mockEnvioClient.fetchState.mockResolvedValue(1000);

      const signal = createSignal({
        type: "condition",
        left: {
          type: "expression",
          operator: "mul",
          left: {
            type: "state",
            entity_type: "Position",
            filters: [{ field: "user", op: "eq", value: "0x123" }],
            field: "supplyShares",
          },
          right: { type: "constant", value: 0.1 },
        },
        operator: "eq",
        right: { type: "constant", value: 100 },
      });

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);

      expect(result.triggered).toBe(true);
    });

    it("evaluates change-style state comparisons using current and window_start snapshots", async () => {
      const now = Date.now();
      const signal = createSignal(
        {
          type: "condition",
          left: {
            type: "state",
            entity_type: "Position",
            filters: [
              { field: "marketId", op: "eq", value: "0xmarket" },
              { field: "user", op: "eq", value: "0x123" },
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
              entity_type: "Position",
              filters: [
                { field: "marketId", op: "eq", value: "0xmarket" },
                { field: "user", op: "eq", value: "0x123" },
              ],
              field: "supplyShares",
              snapshot: "window_start",
            },
            right: { type: "constant", value: 0.8 },
          },
        },
        { window: { duration: "7d" } },
      );

      mockEnvioClient.fetchState
        .mockResolvedValueOnce(700) // current
        .mockResolvedValueOnce(1000); // window_start baseline

      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const evaluator = new SignalEvaluator(mockEnvioClient);
        const result = await evaluator.evaluate(signal);

        expect(result.triggered).toBe(true); // 700 < 0.8 * 1000
        expect(mockEnvioClient.fetchState).toHaveBeenCalledTimes(2);
        expect(mockEnvioClient.fetchState).toHaveBeenNthCalledWith(
          1,
          expect.any(Object),
          undefined,
        );
        expect(mockEnvioClient.fetchState).toHaveBeenNthCalledWith(
          2,
          expect.any(Object),
          now - 7 * 24 * 60 * 60 * 1000,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("window duration parsing", () => {
    it("parses seconds correctly", async () => {
      const signal = createSignal(
        {
          type: "condition",
          left: { type: "constant", value: 1 },
          operator: "eq",
          right: { type: "constant", value: 1 },
        },
        { window: { duration: "30s" } },
      );

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);
      expect(result.triggered).toBe(true);
    });

    it("parses minutes correctly", async () => {
      const signal = createSignal(
        {
          type: "condition",
          left: { type: "constant", value: 1 },
          operator: "eq",
          right: { type: "constant", value: 1 },
        },
        { window: { duration: "30m" } },
      );

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);
      expect(result.triggered).toBe(true);
    });

    it("parses hours correctly", async () => {
      const signal = createSignal(
        {
          type: "condition",
          left: { type: "constant", value: 1 },
          operator: "eq",
          right: { type: "constant", value: 1 },
        },
        { window: { duration: "24h" } },
      );

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);
      expect(result.triggered).toBe(true);
    });

    it("parses days correctly", async () => {
      const signal = createSignal(
        {
          type: "condition",
          left: { type: "constant", value: 1 },
          operator: "eq",
          right: { type: "constant", value: 1 },
        },
        { window: { duration: "7d" } },
      );

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);
      expect(result.triggered).toBe(true);
    });

    it("returns inconclusive result for invalid duration", async () => {
      const signal = createSignal(
        {
          type: "condition",
          left: { type: "constant", value: 1 },
          operator: "eq",
          right: { type: "constant", value: 1 },
        },
        { window: { duration: "invalid" } },
      );

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);
      expect(result.conclusive).toBe(false);
      expect(result.error).toContain("Invalid duration format");
    });
  });

  describe("multi-chain support", () => {
    it("uses first chain id from signal", async () => {
      const signal = createSignal(
        {
          type: "condition",
          left: { type: "constant", value: 1 },
          operator: "eq",
          right: { type: "constant", value: 1 },
        },
        { chains: [8453, 1] },
      );

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);
      expect(result.triggered).toBe(true);
    });

    it("defaults to chain 1 when no chains specified", async () => {
      const signal = createSignal(
        {
          type: "condition",
          left: { type: "constant", value: 1 },
          operator: "eq",
          right: { type: "constant", value: 1 },
        },
        { chains: [] },
      );

      const evaluator = new SignalEvaluator(mockEnvioClient);
      const result = await evaluator.evaluate(signal);
      expect(result.triggered).toBe(true);
    });
  });
});

describe("evaluateNode additional tests", () => {
  const mockContext: EvalContext = {
    chainId: 1,
    windowDuration: "1h",
    now: Date.now(),
    windowStart: Date.now() - 3600000,
    fetchState: vi.fn<FetchStateFn>(),
    fetchEvents: vi.fn<FetchEventsFn>(),
  };

  describe("math operations", () => {
    it("evaluates subtraction correctly", async () => {
      const node: ExpressionNode = {
        type: "expression",
        operator: "sub",
        left: { type: "constant", value: 100 },
        right: { type: "constant", value: 30 },
      };
      const result = await evaluateNode(node, mockContext);
      expect(result).toBe(70);
    });

    it("evaluates multiplication correctly", async () => {
      const node: ExpressionNode = {
        type: "expression",
        operator: "mul",
        left: { type: "constant", value: 7 },
        right: { type: "constant", value: 6 },
      };
      const result = await evaluateNode(node, mockContext);
      expect(result).toBe(42);
    });

    it("evaluates division correctly", async () => {
      const node: ExpressionNode = {
        type: "expression",
        operator: "div",
        left: { type: "constant", value: 100 },
        right: { type: "constant", value: 4 },
      };
      const result = await evaluateNode(node, mockContext);
      expect(result).toBe(25);
    });

    it("handles subtraction resulting in negative", async () => {
      const node: ExpressionNode = {
        type: "expression",
        operator: "sub",
        left: { type: "constant", value: 10 },
        right: { type: "constant", value: 50 },
      };
      const result = await evaluateNode(node, mockContext);
      expect(result).toBe(-40);
    });
  });

  describe("state refs with snapshot", () => {
    it("calls fetchState with undefined for current snapshot", async () => {
      const ctx: EvalContext = {
        ...mockContext,
        fetchState: vi.fn<FetchStateFn>().mockResolvedValue(500),
      };

      const node: ExpressionNode = {
        type: "state",
        entity_type: "Position",
        filters: [],
        field: "supplyShares",
        snapshot: "current",
      };

      await evaluateNode(node, ctx);
      expect(ctx.fetchState).toHaveBeenCalledWith(node, undefined);
    });

    it("calls fetchState with window_start timestamp", async () => {
      const ctx: EvalContext = {
        ...mockContext,
        fetchState: vi.fn<FetchStateFn>().mockResolvedValue(500),
      };

      const node: ExpressionNode = {
        type: "state",
        entity_type: "Position",
        filters: [],
        field: "supplyShares",
        snapshot: "window_start",
      };

      await evaluateNode(node, ctx);
      expect(ctx.fetchState).toHaveBeenCalledWith(node, ctx.windowStart);
    });
  });

  describe("event refs with custom window", () => {
    it("uses signal window when no custom window specified", async () => {
      const ctx: EvalContext = {
        ...mockContext,
        fetchEvents: vi.fn<FetchEventsFn>().mockResolvedValue(100),
      };

      const node: ExpressionNode = {
        type: "event",
        event_type: "Supply",
        filters: [],
        field: "assets",
        aggregation: "sum",
      };

      await evaluateNode(node, ctx);
      expect(ctx.fetchEvents).toHaveBeenCalledWith(node, ctx.windowStart, ctx.now);
    });

    it("uses custom window when specified", async () => {
      const ctx: EvalContext = {
        ...mockContext,
        now: 1000000000000, // Fixed timestamp for testing
        windowStart: 1000000000000 - 3600000, // 1h window
        fetchEvents: vi.fn<FetchEventsFn>().mockResolvedValue(100),
      };

      const node: ExpressionNode = {
        type: "event",
        event_type: "Supply",
        filters: [],
        field: "assets",
        aggregation: "sum",
        window: "7d", // Custom 7 day window
      };

      await evaluateNode(node, ctx);

      // Should use custom window (7d = 604800000ms)
      const expectedStart = ctx.now - 7 * 24 * 60 * 60 * 1000;
      expect(ctx.fetchEvents).toHaveBeenCalledWith(node, expectedStart, ctx.now);
    });
  });
});
