import { describe, expect, it } from "vitest";
import {
  type CompiledAggregateCondition,
  type CompiledGroupCondition,
  compileCondition,
  compileConditions,
  isGroupCondition,
  isSimpleCondition,
} from "../../src/engine/compiler.ts";
import { planMorphoStateRead } from "../../src/protocols/morpho/index.ts";
import type {
  BinaryExpression,
  Condition as InternalCondition,
  StateRef,
} from "../../src/types/index.ts";
import type {
  AggregateCondition,
  ChangeCondition,
  GroupCondition,
  RawEventsCondition,
  ThresholdCondition,
} from "../../src/types/signal.ts";

describe("Compiler", () => {
  describe("compileCondition - threshold", () => {
    it("compiles simple threshold condition for Position", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Position.supplyShares",
        operator: ">",
        value: 1000000,
        chain_id: 1,
        market_id: "0xmarket123",
        address: "0xuser123",
      };

      const result = compileCondition(userCondition);

      expect(isSimpleCondition(result)).toBe(true);
      const cond = result as InternalCondition;
      expect(cond.type).toBe("condition");
      expect(cond.operator).toBe("gt");
      expect(cond.right).toEqual({ type: "constant", value: 1000000 });
    });

    it("includes chainId, marketId, and address in filters for Position", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Position.supplyShares",
        operator: ">=",
        value: 500000,
        chain_id: 1,
        market_id: "0xmarket123",
        address: "0xwhale123",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe("gte");
      expect(result.left).toMatchObject({
        type: "state",
        entity_type: "Position",
        filters: expect.arrayContaining([
          { field: "chainId", op: "eq", value: 1 },
          { field: "marketId", op: "eq", value: "0xmarket123" },
          { field: "user", op: "eq", value: "0xwhale123" },
        ]),
      });
    });

    it("compiles threshold with market filter", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Market.totalSupplyAssets",
        operator: "<",
        value: 10000000,
        chain_id: 1,
        market_id: "0x1111111111111111111111111111111111111111111111111111111111111111",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe("lt");
      expect(result.left).toMatchObject({
        type: "state",
        entity_type: "Market",
        filters: expect.arrayContaining([
          { field: "chainId", op: "eq", value: 1 },
          {
            field: "marketId",
            op: "eq",
            value: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
        ]),
      });

      const rpcPlan = planMorphoStateRead(result.left as StateRef, undefined, 1);
      expect(rpcPlan).toMatchObject({
        family: "state",
        provider: "rpc",
        chainId: 1,
      });
    });

    it("compiles Morpho.Market.utilization as computed expression", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Market.utilization",
        operator: ">",
        value: 0.9,
        chain_id: 1,
        market_id: "0xmarket123",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // Utilization should be compiled as borrow/supply division
      expect(result.left).toMatchObject({
        type: "expression",
        operator: "div",
        left: expect.objectContaining({
          type: "state",
          entity_type: "Market",
          field: "totalBorrowAssets",
        }),
        right: expect.objectContaining({
          type: "state",
          entity_type: "Market",
          field: "totalSupplyAssets",
        }),
      });
    });

    it("compiles chained event metric (netSupply = Supply - Withdraw)", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Flow.netSupply",
        operator: "<",
        value: 0,
        chain_id: 1,
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // Should compile to: Supply.assets - Withdraw.assets < 0
      expect(result.operator).toBe("lt");
      const leftExpr = result.left as BinaryExpression;
      expect(leftExpr.type).toBe("expression");
      expect(leftExpr.operator).toBe("sub");
      expect(leftExpr.left).toMatchObject({
        type: "event",
        event_type: "Morpho_Supply",
        field: "assets",
        aggregation: "sum",
      });
      expect(leftExpr.right).toMatchObject({
        type: "event",
        event_type: "Morpho_Withdraw",
        field: "assets",
        aggregation: "sum",
      });
    });

    it("includes event filters for event metrics", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Event.Supply.assets",
        operator: ">",
        value: 100,
        chain_id: 1,
        filters: [
          { field: "caller", op: "eq", value: "0xcaller" },
          { field: "isMonarch", op: "eq", value: true },
        ],
      };

      const result = compileCondition(userCondition) as InternalCondition;
      expect(result.left).toMatchObject({
        type: "event",
        event_type: "Morpho_Supply",
        filters: expect.arrayContaining([
          { field: "chainId", op: "eq", value: 1 },
          { field: "caller", op: "eq", value: "0xcaller" },
          { field: "isMonarch", op: "eq", value: true },
        ]),
      });
    });

    it("rejects filters for non-event metrics", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Market.totalBorrowAssets",
        operator: ">",
        value: 100,
        chain_id: 1,
        market_id: "0xmarket",
        filters: [{ field: "caller", op: "eq", value: "0xcaller" }],
      };

      expect(() => compileCondition(userCondition)).toThrow("filters are only supported");
    });

    it("maps all comparison operators correctly", () => {
      const operators: Array<{ input: ">" | "<" | ">=" | "<=" | "==" | "!="; expected: string }> = [
        { input: ">", expected: "gt" },
        { input: ">=", expected: "gte" },
        { input: "<", expected: "lt" },
        { input: "<=", expected: "lte" },
        { input: "==", expected: "eq" },
        { input: "!=", expected: "neq" },
      ];

      for (const { input, expected } of operators) {
        const result = compileCondition({
          type: "threshold",
          metric: "Morpho.Position.supplyShares",
          operator: input,
          value: 100,
          chain_id: 1,
          market_id: "0xmarket",
          address: "0xuser",
        }) as InternalCondition;

        expect(result.operator).toBe(expected);
      }
    });
  });

  describe("compileCondition - change", () => {
    it("compiles percent decrease condition", () => {
      const userCondition: ChangeCondition = {
        type: "change",
        metric: "Morpho.Position.supplyShares",
        direction: "decrease",
        by: { percent: 10 },
        chain_id: 1,
        market_id: "0xmarket",
        address: "0xuser",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // current < past * 0.9
      expect(result.operator).toBe("lt");
      expect(result.left).toMatchObject({
        type: "state",
        snapshot: "current",
      });
      expect(result.right).toMatchObject({
        type: "expression",
        operator: "mul",
        left: expect.objectContaining({
          type: "state",
          snapshot: "window_start",
        }),
        right: { type: "constant", value: 0.9 },
      });
    });

    it("compiles percent increase condition", () => {
      const userCondition: ChangeCondition = {
        type: "change",
        metric: "Morpho.Position.supplyShares",
        direction: "increase",
        by: { percent: 20 },
        chain_id: 1,
        market_id: "0xmarket",
        address: "0xuser",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // current > past * 1.2
      expect(result.operator).toBe("gt");
      expect(result.right).toMatchObject({
        type: "expression",
        operator: "mul",
        right: { type: "constant", value: 1.2 },
      });
    });

    it("compiles absolute decrease condition", () => {
      const userCondition: ChangeCondition = {
        type: "change",
        metric: "Morpho.Position.supplyShares",
        direction: "decrease",
        by: { absolute: 1000000 },
        chain_id: 1,
        market_id: "0xmarket",
        address: "0xuser",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // (past - current) > 1000000
      expect(result.operator).toBe("gt");
      expect(result.left).toMatchObject({
        type: "expression",
        operator: "sub",
      });
      expect(result.right).toEqual({ type: "constant", value: 1000000 });
    });

    it("compiles absolute increase condition", () => {
      const userCondition: ChangeCondition = {
        type: "change",
        metric: "Morpho.Position.supplyShares",
        direction: "increase",
        by: { absolute: 500000 },
        chain_id: 1,
        market_id: "0xmarket",
        address: "0xuser",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // (current - past) > 500000
      expect(result.operator).toBe("gt");
      expect(result.left).toMatchObject({
        type: "expression",
        operator: "sub",
      });
    });

    it("includes filters from condition", () => {
      const userCondition: ChangeCondition = {
        type: "change",
        metric: "Morpho.Position.supplyShares",
        direction: "decrease",
        by: { percent: 20 },
        chain_id: 1,
        market_id: "0xmarket123",
        address: "0xwhale456",
      };

      const result = compileCondition(userCondition) as InternalCondition;

      // Both current and past state refs should have the filters
      expect(result.left).toMatchObject({
        type: "state",
        filters: expect.arrayContaining([
          { field: "chainId", op: "eq", value: 1 },
          { field: "marketId", op: "eq", value: "0xmarket123" },
          { field: "user", op: "eq", value: "0xwhale456" },
        ]),
      });
    });
  });

  describe("compileCondition - group", () => {
    it("compiles group condition with N-of-M requirement", () => {
      const userCondition: GroupCondition = {
        type: "group",
        addresses: ["0xa", "0xb", "0xc", "0xd", "0xe"],
        requirement: { count: 3, of: 5 },
        conditions: [
          {
            type: "change",
            metric: "Morpho.Position.supplyShares",
            direction: "decrease",
            by: { percent: 10 },
            chain_id: 1,
            market_id: "0xmarket",
            address: "0xplaceholder", // Will be replaced per-address at eval time
          },
        ],
      };

      const result = compileCondition(userCondition);

      expect(isGroupCondition(result)).toBe(true);
      const groupResult = result as CompiledGroupCondition;
      expect(groupResult.type).toBe("group");
      expect(groupResult.addresses).toEqual(["0xa", "0xb", "0xc", "0xd", "0xe"]);
      expect(groupResult.requirement).toEqual({ count: 3, of: 5 });
      expect(groupResult.perAddressConditions).toHaveLength(1);
    });

    it("compiles inner condition correctly", () => {
      const userCondition: GroupCondition = {
        type: "group",
        addresses: ["0xa", "0xb"],
        requirement: { count: 1, of: 2 },
        conditions: [
          {
            type: "threshold",
            metric: "Morpho.Position.supplyShares",
            operator: "<",
            value: 100,
            chain_id: 1,
            market_id: "0xmarket",
            address: "0xplaceholder",
          },
        ],
      };

      const result = compileCondition(userCondition) as CompiledGroupCondition;

      expect(result.perAddressConditions).toHaveLength(1);
      expect(result.perAddressConditions[0].type).toBe("condition");
      expect(result.perAddressConditions[0].operator).toBe("lt");
    });
  });

  describe("compileCondition - aggregate", () => {
    it("compiles aggregate sum condition", () => {
      const userCondition: AggregateCondition = {
        type: "aggregate",
        aggregation: "sum",
        metric: "Morpho.Market.totalSupplyAssets",
        operator: ">",
        value: 10000000,
        chain_id: 1,
      };

      const result = compileCondition(userCondition) as CompiledAggregateCondition;

      expect(result.type).toBe("aggregate");
      expect(result.aggregation).toBe("sum");
      expect(result.metric).toBe("Morpho.Market.totalSupplyAssets");
      expect(result.operator).toBe("gt");
      expect(result.value).toBe(10000000);
      expect(result.chainId).toBe(1);
    });
  });

  describe("validation", () => {
    it("throws on unknown metric", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Unknown.Metric.field",
        operator: ">",
        value: 100,
        chain_id: 1,
      };

      expect(() => compileCondition(userCondition)).toThrow("Unknown metric");
    });

    it("throws when chain_id is missing", () => {
      const userCondition = {
        type: "threshold",
        metric: "Morpho.Position.supplyShares",
        operator: ">",
        value: 100,
        market_id: "0xmarket",
        address: "0xuser",
      } as ThresholdCondition;

      expect(() => compileCondition(userCondition)).toThrow("chain_id is required");
    });

    it("throws when market_id is missing for Market metric", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Market.totalSupplyAssets",
        operator: ">",
        value: 100,
        chain_id: 1,
      };

      expect(() => compileCondition(userCondition)).toThrow("market_id is required");
    });

    it("throws when address is missing for Position metric", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Position.supplyShares",
        operator: ">",
        value: 100,
        chain_id: 1,
        market_id: "0xmarket",
      };

      expect(() => compileCondition(userCondition)).toThrow("address is required");
    });

    it("allows Event metrics without market_id or address", () => {
      const userCondition: ThresholdCondition = {
        type: "threshold",
        metric: "Morpho.Flow.netSupply",
        operator: "<",
        value: 0,
        chain_id: 1,
      };

      // Should not throw
      const result = compileCondition(userCondition);
      expect(result).toBeDefined();
    });
  });

  describe("compileConditions", () => {
    it("compiles multiple conditions with AND logic", () => {
      const conditions = [
        {
          type: "threshold" as const,
          metric: "Morpho.Position.supplyShares",
          operator: ">" as const,
          value: 1000,
          chain_id: 1,
          market_id: "0xmarket",
          address: "0xuser",
        },
        {
          type: "threshold" as const,
          metric: "Morpho.Market.totalSupplyAssets",
          operator: "<" as const,
          value: 5000000,
          chain_id: 1,
          market_id: "0xmarket",
        },
      ];

      const result = compileConditions(conditions, "AND");

      expect(result.logic).toBe("AND");
      expect(result.conditions).toHaveLength(2);
    });

    it("compiles multiple conditions with OR logic", () => {
      const conditions = [
        {
          type: "threshold" as const,
          metric: "Morpho.Position.supplyShares",
          operator: ">" as const,
          value: 1000,
          chain_id: 1,
          market_id: "0xmarket",
          address: "0xuser",
        },
      ];

      const result = compileConditions(conditions, "OR");

      expect(result.logic).toBe("OR");
    });

    it("defaults to AND logic", () => {
      const conditions = [
        {
          type: "threshold" as const,
          metric: "Morpho.Position.supplyShares",
          operator: ">" as const,
          value: 1000,
          chain_id: 1,
          market_id: "0xmarket",
          address: "0xuser",
        },
      ];

      const result = compileConditions(conditions);

      expect(result.logic).toBe("AND");
    });
  });

  describe("compileCondition - raw-events", () => {
    it("compiles ERC721 transfer preset into a raw_event expression", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "sum",
        operator: ">",
        value: 2,
        field: "tokenId",
        chain_id: 1,
        event: {
          kind: "erc721_transfer",
          contract_addresses: ["0x1111111111111111111111111111111111111111"],
        },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.left).toMatchObject({
        type: "raw_event",
        source: "hypersync",
        chainId: 1,
        field: "tokenId",
        aggregation: "sum",
        contractAddresses: ["0x1111111111111111111111111111111111111111"],
        queries: [
          {
            topic0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            normalizer: "none",
          },
        ],
      });
    });

    it("compiles ERC4626 deposit preset into a raw_event expression", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "count",
        operator: ">",
        value: 0,
        chain_id: 1,
        event: {
          kind: "erc4626_deposit",
          contract_addresses: ["0x1111111111111111111111111111111111111111"],
        },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.left).toMatchObject({
        type: "raw_event",
        source: "hypersync",
        chainId: 1,
        aggregation: "count",
        contractAddresses: ["0x1111111111111111111111111111111111111111"],
        queries: [
          {
            topic0: "0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7",
            normalizer: "none",
          },
        ],
      });
    });

    it("compiles ERC4626 withdraw preset into a raw_event expression", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "count",
        operator: ">",
        value: 0,
        chain_id: 1,
        event: {
          kind: "erc4626_withdraw",
          contract_addresses: ["0x1111111111111111111111111111111111111111"],
        },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.left).toMatchObject({
        type: "raw_event",
        source: "hypersync",
        chainId: 1,
        aggregation: "count",
        contractAddresses: ["0x1111111111111111111111111111111111111111"],
        queries: [
          {
            topic0: "0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db",
            normalizer: "none",
          },
        ],
      });
    });

    it("compiles raw ERC20 transfer aggregation into a raw_event expression", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "sum",
        operator: ">",
        value: 1000,
        field: "value",
        chain_id: 1,
        event: {
          kind: "erc20_transfer",
          contract_addresses: ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
        },
        filters: [{ field: "from", op: "eq", value: "0x1111111111111111111111111111111111111111" }],
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.operator).toBe("gt");
      expect(result.left).toMatchObject({
        type: "raw_event",
        source: "hypersync",
        chainId: 1,
        field: "value",
        aggregation: "sum",
        contractAddresses: ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
        queries: [
          {
            topic0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            normalizer: "none",
          },
        ],
      });
    });

    it("rejects raw-events sum aggregation without a field", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "sum",
        operator: ">",
        value: 1,
        chain_id: 1,
        event: {
          kind: "contract_event",
          signature: "Swap(address indexed sender, uint amount0In, uint amount1In)",
        },
      };

      expect(() => compileCondition(userCondition)).toThrow("field is required");
    });

    it("compiles swap preset into multi-query normalized raw event reads", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "sum",
        operator: ">",
        value: 5000,
        field: "amount0_abs",
        chain_id: 1,
        event: {
          kind: "swap",
          protocols: ["uniswap_v2", "uniswap_v3"],
        },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.left).toMatchObject({
        type: "raw_event",
        field: "amount0_abs",
        aggregation: "sum",
        queries: [{ normalizer: "uniswap_v2_swap" }, { normalizer: "uniswap_v3_swap" }],
      });
    });

    it("deduplicates repeated swap protocols before building raw event queries", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "sum",
        operator: ">",
        value: 5000,
        field: "amount0_abs",
        chain_id: 1,
        event: {
          kind: "swap",
          protocols: ["uniswap_v3", "uniswap_v3", "uniswap_v2"],
        },
      };

      const result = compileCondition(userCondition) as InternalCondition;

      expect(result.left).toMatchObject({
        type: "raw_event",
        queries: [{ normalizer: "uniswap_v3_swap" }, { normalizer: "uniswap_v2_swap" }],
      });
      expect(result.left.type === "raw_event" ? result.left.queries : []).toHaveLength(2);
    });

    it("rejects signature for non-contract-event presets", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "count",
        operator: ">",
        value: 0,
        chain_id: 1,
        event: {
          kind: "erc20_transfer",
          signature: "Transfer(address indexed from, address indexed to, uint256 value)",
        },
      };

      expect(() => compileCondition(userCondition)).toThrow(
        "signature is only supported for contract_event raw-events",
      );
    });

    it("rejects protocols for non-swap presets", () => {
      const userCondition: RawEventsCondition = {
        type: "raw-events",
        aggregation: "count",
        operator: ">",
        value: 0,
        chain_id: 1,
        event: {
          kind: "erc20_approval",
          protocols: ["uniswap_v2"],
        },
      };

      expect(() => compileCondition(userCondition)).toThrow(
        "protocols are only supported for swap raw-events",
      );
    });
  });
});
