import { describe, expect, it } from "vitest";
import type { EventRef, StateRef } from "../types/index.js";
import type { SignalDefinition } from "../types/signal.js";
import { compileSignalDefinition } from "./compile-signal.js";
import { SignalEvaluator } from "./condition.js";
import type { DataFetcher } from "./fetcher.js";

function getFilterValue(ref: StateRef | EventRef, field: string): string | number | undefined {
  const match = ref.filters.find((filter) => filter.field === field && filter.op === "eq");
  return match?.value as string | number | undefined;
}

describe("SignalEvaluator logic", () => {
  it("evaluates group conditions across addresses", async () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["market-1"] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "group",
          addresses: ["0x1", "0x2", "0x3"],
          requirement: { count: 2, of: 3 },
          conditions: [
            {
              type: "threshold",
              metric: "Morpho.Position.supplyShares",
              operator: ">",
              value: 100,
              chain_id: 1,
              market_id: "market-1",
            },
          ],
        },
      ],
    };

    const compiled = compileSignalDefinition(definition);

    const fetcher: DataFetcher = {
      fetchState: async (ref: StateRef) => {
        const user = getFilterValue(ref, "user");
        if (user === "0x1") return 150;
        if (user === "0x2") return 50;
        if (user === "0x3") return 200;
        return 0;
      },
      fetchEvents: async () => 0,
    };

    const evaluator = new SignalEvaluator(fetcher);
    const result = await evaluator.evaluate({
      id: "sig-1",
      chains: compiled.ast.chains,
      window: compiled.ast.window,
      conditions: compiled.ast.conditions,
      logic: compiled.ast.logic,
    });

    expect(result.triggered).toBe(true);
  });

  it("evaluates aggregate conditions across markets", async () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["m1", "m2"] },
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

    const compiled = compileSignalDefinition(definition);

    const fetcher: DataFetcher = {
      fetchState: async (ref: StateRef) => {
        const marketId = getFilterValue(ref, "marketId");
        if (marketId === "m1") return 600;
        if (marketId === "m2") return 500;
        return 0;
      },
      fetchEvents: async () => 0,
    };

    const evaluator = new SignalEvaluator(fetcher);
    const result = await evaluator.evaluate({
      id: "sig-2",
      chains: compiled.ast.chains,
      window: compiled.ast.window,
      conditions: compiled.ast.conditions,
      logic: compiled.ast.logic,
    });

    expect(result.triggered).toBe(true);
  });

  it("evaluates group conditions with multiple inner conditions per address", async () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["market-1"] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "group",
          addresses: ["0x1", "0x2"],
          requirement: { count: 1, of: 2 },
          logic: "AND",
          conditions: [
            {
              type: "threshold",
              metric: "Morpho.Position.supplyShares",
              operator: ">",
              value: 100,
              chain_id: 1,
              market_id: "market-1",
            },
            {
              type: "threshold",
              metric: "Morpho.Position.collateral",
              operator: ">",
              value: 50,
              chain_id: 1,
              market_id: "market-1",
            },
          ],
        },
      ],
    };

    const compiled = compileSignalDefinition(definition);

    const fetcher: DataFetcher = {
      fetchState: async (ref: StateRef) => {
        const user = getFilterValue(ref, "user");
        if (ref.field === "supplyShares") {
          if (user === "0x1") return 150;
          if (user === "0x2") return 150;
        }
        if (ref.field === "collateral") {
          if (user === "0x1") return 60;
          if (user === "0x2") return 10;
        }
        return 0;
      },
      fetchEvents: async () => 0,
    };

    const evaluator = new SignalEvaluator(fetcher);
    const result = await evaluator.evaluate({
      id: "sig-4",
      chains: compiled.ast.chains,
      window: compiled.ast.window,
      conditions: compiled.ast.conditions,
      logic: compiled.ast.logic,
    });

    expect(result.triggered).toBe(true);
  });

  it("evaluates multi-condition AND logic", async () => {
    const definition: SignalDefinition = {
      scope: { chains: [1], markets: ["m1"] },
      window: { duration: "1h" },
      logic: "AND",
      conditions: [
        {
          type: "threshold",
          metric: "Morpho.Market.totalBorrowAssets",
          operator: ">",
          value: 100,
          chain_id: 1,
          market_id: "m1",
        },
        {
          type: "threshold",
          metric: "Morpho.Market.totalSupplyAssets",
          operator: ">",
          value: 200,
          chain_id: 1,
          market_id: "m1",
        },
      ],
    };

    const compiled = compileSignalDefinition(definition);

    const fetcher: DataFetcher = {
      fetchState: async (ref: StateRef) => {
        if (ref.field === "totalBorrowAssets") return 150;
        if (ref.field === "totalSupplyAssets") return 500;
        return 0;
      },
      fetchEvents: async () => 0,
    };

    const evaluator = new SignalEvaluator(fetcher);
    const result = await evaluator.evaluate({
      id: "sig-3",
      chains: compiled.ast.chains,
      window: compiled.ast.window,
      conditions: compiled.ast.conditions,
      logic: compiled.ast.logic,
    });

    expect(result.triggered).toBe(true);
  });
});
