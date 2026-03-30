import { describe, expect, it } from "vitest";
import {
  bindMorphoRpcStateRead,
  planGenericRpcStateRead,
  planMorphoEventRead,
  planMorphoRawEventRead,
  planMorphoStateRead,
  planRpcStateRead,
} from "../../src/engine/source-plan.js";
import type { EventRef, RawEventRef, StateRef } from "../../src/types/index.js";

describe("source plan", () => {
  it("plans generic state reads through RPC using the default chain", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "totalBorrowAssets",
    };

    expect(planGenericRpcStateRead(ref, undefined, 1)).toEqual({
      family: "state",
      provider: "rpc",
      chainId: 1,
      ref,
      timestamp: undefined,
    });
  });

  it("binds generic state reads to Morpho runtime requirements", () => {
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
    const plannedRead = planGenericRpcStateRead(ref, 1700000000000, 1);

    expect(bindMorphoRpcStateRead(plannedRead)).toEqual({
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

  it("preserves legacy Morpho state planner behavior", () => {
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

  it("rejects missing market filters when binding Morpho state reads", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Market",
      filters: [],
      field: "totalBorrowAssets",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      "marketId filter required for state queries",
    );
  });

  it("rejects Position state reads missing user filters when binding Morpho state reads", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Position",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "supplyShares",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      "user filter required for Position queries",
    );
  });

  it("keeps legacy planRpcStateRead behavior for compatibility", () => {
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

    expect(planRpcStateRead(ref, 1700000000000, 1)).toEqual({
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
