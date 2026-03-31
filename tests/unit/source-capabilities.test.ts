import { describe, expect, it } from "vitest";
import {
  SourceCapabilityError,
  assertSignalDefinitionSourcesEnabled,
  collectSignalSourceUsage,
  createSourceCapabilities,
  getSourceCapabilityHealth,
  getSourceCapabilityStatusLines,
} from "../../src/engine/source-capabilities.ts";
import type { SignalDefinition } from "../../src/types/signal.ts";

describe("source capabilities", () => {
  it("collects source families used by a mixed signal definition", () => {
    const definition: SignalDefinition = {
      scope: {
        chains: [1],
        markets: ["0xmarket"],
        addresses: ["0xuser"],
        protocol: "morpho",
      },
      window: { duration: "1d" },
      logic: "AND",
      conditions: [
        {
          type: "threshold",
          metric: "Morpho.Market.utilization",
          operator: ">",
          value: 0.8,
          chain_id: 1,
          market_id: "0xmarket",
        },
        {
          type: "aggregate",
          aggregation: "sum",
          metric: "Morpho.Flow.netSupply",
          operator: ">",
          value: 1_000,
          chain_id: 1,
          market_id: "0xmarket",
        },
        {
          type: "raw-events",
          aggregation: "count",
          operator: ">",
          value: 5,
          chain_id: 1,
          event: {
            kind: "erc20_transfer",
          },
        },
      ],
    };

    const usage = collectSignalSourceUsage(definition);

    expect(usage.families).toEqual(expect.arrayContaining(["state", "indexed", "raw"]));
    expect(usage.metrics.state).toContain("Morpho.Market.utilization");
    expect(usage.metrics.indexed).toContain("Morpho.Flow.netSupply");
    expect(usage.rawEventKinds).toEqual(["erc20_transfer"]);
  });

  it("rejects a signal definition when a required family is disabled", () => {
    const definition: SignalDefinition = {
      scope: { chains: [1] },
      window: { duration: "1h" },
      conditions: [
        {
          type: "raw-events",
          aggregation: "count",
          operator: ">",
          value: 0,
          chain_id: 1,
          event: {
            kind: "swap",
            protocols: ["uniswap_v3"],
          },
        },
      ],
    };

    const capabilities = createSourceCapabilities({
      envioEndpoint: "https://envio.example/graphql",
      hypersyncApiToken: "",
    });

    expect(() => assertSignalDefinitionSourcesEnabled(definition, capabilities)).toThrowError(
      SourceCapabilityError,
    );
    expect(() => assertSignalDefinitionSourcesEnabled(definition, capabilities)).toThrow(
      "raw event source family is disabled because ENVIO_API_TOKEN is not configured",
    );
  });

  it("marks indexed semantics as an advanced source family in health output", () => {
    const capabilities = createSourceCapabilities({
      envioEndpoint: "",
      hypersyncApiToken: "token",
    });

    const health = getSourceCapabilityHealth(capabilities);

    expect(health.indexed.tier).toBe("advanced");
    expect(health.indexed.label).toBe("advanced indexed semantic source family");
    expect(health.indexed.message).toContain("advanced indexed semantic source family is disabled");
  });

  it("uses advanced/default wording in capability status lines", () => {
    const capabilities = createSourceCapabilities({
      envioEndpoint: "https://envio.example/graphql",
      hypersyncApiToken: "token",
    });

    const lines = getSourceCapabilityStatusLines(capabilities);

    expect(lines).toContain("advanced indexed semantic source family enabled via envio");
    expect(lines).toContain("raw event source family enabled via hypersync");
  });
});
