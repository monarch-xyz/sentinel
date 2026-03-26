import { describe, expect, it } from "vitest";
import type { SignalDefinition } from "../types/signal.js";
import { compileSignalDefinition } from "./compile-signal.js";

const baseDefinition: SignalDefinition = {
  scope: {
    chains: [1],
    markets: ["m1"],
    addresses: ["0x1"],
  },
  window: { duration: "1h" },
  conditions: [
    {
      type: "threshold",
      metric: "Morpho.Market.totalBorrowAssets",
      operator: ">",
      value: 100,
      chain_id: 1,
      market_id: "m1",
    },
  ],
};

describe("compileSignalDefinition", () => {
  it("defaults logic to AND", () => {
    const compiled = compileSignalDefinition(baseDefinition);
    expect(compiled.ast.logic).toBe("AND");
    expect(compiled.ast.conditions).toHaveLength(1);
  });

  it("compiles multiple conditions with OR logic", () => {
    const compiled = compileSignalDefinition({
      ...baseDefinition,
      logic: "OR",
      conditions: [
        baseDefinition.conditions[0],
        {
          type: "threshold",
          metric: "Morpho.Market.totalSupplyAssets",
          operator: ">",
          value: 500,
          chain_id: 1,
          market_id: "m1",
        },
      ],
    });

    expect(compiled.ast.logic).toBe("OR");
    expect(compiled.ast.conditions).toHaveLength(2);
  });

  it("rejects group requirement mismatch", () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["m1"] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "group",
          addresses: ["0x1", "0x2"],
          requirement: { count: 1, of: 3 },
          conditions: [
            {
              type: "threshold",
              metric: "Morpho.Position.supplyShares",
              operator: ">",
              value: 100,
              chain_id: 1,
              market_id: "m1",
            },
          ],
        },
      ],
    };

    expect(() => compileSignalDefinition(definition)).toThrow("requirement.of");
  });

  it("rejects group inner condition with address", () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["m1"] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "group",
          addresses: ["0x1"],
          requirement: { count: 1, of: 1 },
          conditions: [
            {
              type: "threshold",
              metric: "Morpho.Position.supplyShares",
              operator: ">",
              value: 100,
              chain_id: 1,
              market_id: "m1",
              address: "0x1",
            },
          ],
        },
      ],
    };

    expect(() => compileSignalDefinition(definition)).toThrow("address");
  });

  it("rejects group with empty conditions", () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["m1"] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "group",
          addresses: ["0x1"],
          requirement: { count: 1, of: 1 },
          conditions: [],
        },
      ],
    };

    expect(() => compileSignalDefinition(definition)).toThrow(
      "Group condition requires at least one inner condition",
    );
  });

  it("rejects aggregate market metric without markets", () => {
    const definition: SignalDefinition = {
      scope: { chains: [1] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "aggregate",
          aggregation: "sum",
          metric: "Morpho.Market.totalBorrowAssets",
          operator: ">",
          value: 1000,
          chain_id: 1,
        },
      ],
    };

    expect(() => compileSignalDefinition(definition)).toThrow("market_id");
  });

  it("rejects aggregate position metric without addresses", () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["m1"] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "aggregate",
          aggregation: "sum",
          metric: "Morpho.Position.supplyShares",
          operator: ">",
          value: 1000,
          chain_id: 1,
        },
      ],
    };

    expect(() => compileSignalDefinition(definition)).toThrow("addresses");
  });

  it("rejects change direction any", () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["m1"], addresses: ["0x1"] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "change",
          metric: "Morpho.Position.supplyShares",
          direction: "any",
          by: { percent: 10 },
          chain_id: 1,
          market_id: "m1",
        },
      ],
    };

    expect(() => compileSignalDefinition(definition)).toThrow("direction");
  });

  it("infers raw-events chain_id from scope", () => {
    const compiled = compileSignalDefinition({
      scope: { chains: [8453] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "raw-events",
          aggregation: "count",
          operator: ">",
          value: 10,
          event: {
            kind: "erc20_transfer",
          },
        },
      ],
    });

    expect(compiled.ast.conditions).toHaveLength(1);
    expect(compiled.ast.conditions[0]).toMatchObject({
      type: "condition",
      left: {
        type: "raw_event",
        chainId: 8453,
        aggregation: "count",
      },
    });
  });

  it("rejects raw-events chain_id inference when scope.chains is ambiguous", () => {
    expect(() =>
      compileSignalDefinition({
        scope: { chains: [1, 8453] },
        window: { duration: "1h" },
        conditions: [
          {
            type: "raw-events",
            aggregation: "count",
            operator: ">",
            value: 10,
            event: {
              kind: "erc20_transfer",
            },
          },
        ],
      }),
    ).toThrow("chain_id is ambiguous");
  });

  describe("public DSL contract examples", () => {
    it("compiles the state metric threshold example", () => {
      const compiled = compileSignalDefinition({
        scope: { chains: [1], markets: ["0xM"] },
        window: { duration: "1h" },
        conditions: [
          {
            type: "threshold",
            metric: "Morpho.Market.utilization",
            operator: ">",
            value: 0.9,
            chain_id: 1,
            market_id: "0xM",
          },
        ],
      });

      expect(compiled.ast.conditions[0]).toMatchObject({
        type: "condition",
        left: {
          type: "expression",
          operator: "div",
        },
      });
    });

    it("compiles the indexed metric aggregate example", () => {
      const compiled = compileSignalDefinition({
        scope: { chains: [1], markets: ["0xM"] },
        window: { duration: "1h" },
        conditions: [
          {
            type: "aggregate",
            aggregation: "sum",
            metric: "Morpho.Event.Supply.assets",
            operator: ">",
            value: 1000000,
            chain_id: 1,
            market_id: "0xM",
          },
        ],
      });

      expect(compiled.ast.conditions[0]).toMatchObject({
        type: "aggregate",
        metric: "Morpho.Event.Supply.assets",
        aggregation: "sum",
        chainId: 1,
        marketIds: ["0xM"],
      });
    });

    it("compiles the raw ERC20 transfer example", () => {
      const compiled = compileSignalDefinition({
        scope: { chains: [1] },
        window: { duration: "1h" },
        conditions: [
          {
            type: "raw-events",
            aggregation: "sum",
            field: "value",
            operator: ">",
            value: 1000000,
            chain_id: 1,
            window: { duration: "1h" },
            event: {
              kind: "erc20_transfer",
              contract_addresses: ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
            },
            filters: [{ field: "from", op: "eq", value: "0xC..." }],
          },
        ],
      });

      expect(compiled.ast.conditions[0]).toMatchObject({
        type: "condition",
        left: {
          type: "raw_event",
          aggregation: "sum",
          field: "value",
          queries: [{ normalizer: "none" }],
        },
      });
    });

    it("compiles the raw swap preset example", () => {
      const compiled = compileSignalDefinition({
        scope: { chains: [1] },
        window: { duration: "30m" },
        conditions: [
          {
            type: "raw-events",
            aggregation: "sum",
            field: "amount0_abs",
            operator: ">",
            value: 500000,
            chain_id: 1,
            window: { duration: "30m" },
            event: {
              kind: "swap",
              protocols: ["uniswap_v2", "uniswap_v3"],
              contract_addresses: ["0xPoolA", "0xPoolB"],
            },
            filters: [{ field: "recipient", op: "eq", value: "0xRecipient" }],
          },
        ],
      });

      expect(compiled.ast.conditions[0]).toMatchObject({
        type: "condition",
        left: {
          type: "raw_event",
          aggregation: "sum",
          field: "amount0_abs",
          queries: [{ normalizer: "uniswap_v2_swap" }, { normalizer: "uniswap_v3_swap" }],
        },
      });
    });

    it("compiles the raw custom contract event example", () => {
      const compiled = compileSignalDefinition({
        scope: { chains: [1] },
        window: { duration: "30m" },
        conditions: [
          {
            type: "raw-events",
            aggregation: "sum",
            field: "amount0In",
            operator: ">",
            value: 500000,
            chain_id: 1,
            window: { duration: "30m" },
            event: {
              kind: "contract_event",
              contract_addresses: ["0xPool"],
              signature:
                "Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
            },
          },
        ],
      });

      expect(compiled.ast.conditions[0]).toMatchObject({
        type: "condition",
        left: {
          type: "raw_event",
          aggregation: "sum",
          field: "amount0In",
          queries: [{ normalizer: "none" }],
        },
      });
    });
  });
});
