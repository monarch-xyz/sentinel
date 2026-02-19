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

    expect(() => compileSignalDefinition(definition)).toThrow("conditions");
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
});
