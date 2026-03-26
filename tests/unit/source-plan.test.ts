import { describe, expect, it } from "vitest";
import {
  planMorphoEventRead,
  planMorphoRawEventRead,
  planMorphoStateRead,
} from "../../src/engine/source-plan.js";
import type { EventRef, RawEventRef, StateRef } from "../../src/types/index.js";

describe("source plan", () => {
  it("plans state reads through RPC using the default chain", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "totalBorrowAssets",
    };

    expect(planMorphoStateRead(ref, undefined, 1)).toEqual({
      family: "state",
      provider: "rpc",
      chainId: 1,
      entityType: "Market",
      field: "totalBorrowAssets",
      marketId: "0xmarket",
      user: undefined,
      timestamp: undefined,
    });
  });

  it("plans position state reads with an explicit user and chain override", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Position",
      filters: [
        { field: "chainId", op: "eq", value: 8453 },
        { field: "marketId", op: "eq", value: "0xmarket" },
        { field: "user", op: "eq", value: "0xuser" },
      ],
      field: "supplyShares",
    };

    expect(planMorphoStateRead(ref, 1700000000000, 1)).toEqual({
      family: "state",
      provider: "rpc",
      chainId: 8453,
      entityType: "Position",
      field: "supplyShares",
      marketId: "0xmarket",
      user: "0xuser",
      timestamp: 1700000000000,
    });
  });

  it("rejects missing market filters for state reads", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Market",
      filters: [],
      field: "totalBorrowAssets",
    };

    expect(() => planMorphoStateRead(ref, undefined, 1)).toThrow(
      "marketId filter required for state queries",
    );
  });

  it("plans event reads through Envio", () => {
    const ref: EventRef = {
      type: "event",
      event_type: "Morpho_Supply",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "assets",
      aggregation: "sum",
    };

    expect(planMorphoEventRead(ref, 1000, 2000, 1)).toEqual({
      family: "indexed",
      provider: "envio",
      chainId: 1,
      ref,
      startTimeMs: 1000,
      endTimeMs: 2000,
    });
  });

  it("plans raw event reads through the indexing raw provider", () => {
    const ref: RawEventRef = {
      type: "raw_event",
      source: "hypersync",
      chainId: 1,
      queries: [
        {
          eventSignature: "event Transfer(address indexed from, address indexed to, uint256 value)",
          topic0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          normalizer: "none",
        },
      ],
      field: "value",
      aggregation: "sum",
    };

    expect(planMorphoRawEventRead(ref, 1000, 2000)).toEqual({
      family: "raw",
      provider: "hypersync",
      chainId: 1,
      ref,
      startTimeMs: 1000,
      endTimeMs: 2000,
    });
  });
});
