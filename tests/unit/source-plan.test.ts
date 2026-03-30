import { describe, expect, it } from "vitest";
import {
  planGenericRpcStateRead,
  planIndexedEventRead,
  planRawEventRead,
} from "../../src/engine/source-plan.ts";
import type { EventRef, RawEventRef, StateRef } from "../../src/types/index.ts";

describe("source plan", () => {
  it("plans generic state reads through RPC using the default chain", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "totalBorrowAssets",
    };

    expect(planGenericRpcStateRead(ref, undefined, 1)).toEqual({
      family: "state",
      provider: "rpc",
      protocol: "morpho",
      chainId: 1,
      ref,
      timestamp: undefined,
    });
  });

  it("uses chainId filter override for generic state reads", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Market",
      filters: [
        { field: "chainId", op: "eq", value: 8453 },
        { field: "marketId", op: "eq", value: "0xmarket" },
      ],
      field: "totalBorrowAssets",
    };

    expect(planGenericRpcStateRead(ref, 1700000000000, 1)).toEqual({
      family: "state",
      provider: "rpc",
      protocol: "morpho",
      chainId: 8453,
      ref,
      timestamp: 1700000000000,
    });
  });

  it("rejects invalid chainId filter values at planning boundary", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Market",
      filters: [
        { field: "chainId", op: "eq", value: "foo" },
        { field: "marketId", op: "eq", value: "0xmarket" },
      ],
      field: "totalBorrowAssets",
    };

    expect(() => planGenericRpcStateRead(ref, undefined, 1)).toThrow(
      "Invalid chainId filter value: foo. Expected a positive integer.",
    );
  });

  it("rejects protocol-less generic state refs", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "totalBorrowAssets",
    };

    expect(() => planGenericRpcStateRead(ref, undefined, 1)).toThrow(
      "State ref protocol is required for generic RPC planning.",
    );
  });

  it("rejects non-strict chainId filter coercions", () => {
    const baseRef: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "totalBorrowAssets",
    };

    expect(() =>
      planGenericRpcStateRead(
        {
          ...baseRef,
          filters: [...baseRef.filters, { field: "chainId", op: "eq", value: "8453foo" }],
        },
        undefined,
        1,
      ),
    ).toThrow("Invalid chainId filter value: 8453foo. Expected a positive integer.");

    expect(() =>
      planGenericRpcStateRead(
        {
          ...baseRef,
          filters: [...baseRef.filters, { field: "chainId", op: "eq", value: "1.5" }],
        },
        undefined,
        1,
      ),
    ).toThrow("Invalid chainId filter value: 1.5. Expected a positive integer.");

    expect(() =>
      planGenericRpcStateRead(
        {
          ...baseRef,
          filters: [...baseRef.filters, { field: "chainId", op: "eq", value: true }],
        },
        undefined,
        1,
      ),
    ).toThrow("Invalid chainId filter value: true. Expected a positive integer.");
  });

  it("plans indexed event reads through Envio", () => {
    const ref: EventRef = {
      type: "event",
      event_type: "Morpho_Supply",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "assets",
      aggregation: "sum",
    };

    expect(planIndexedEventRead(ref, 1000, 2000, 1)).toEqual({
      family: "indexed",
      provider: "envio",
      chainId: 1,
      ref,
      startTimeMs: 1000,
      endTimeMs: 2000,
    });
  });

  it("uses chainId filter override for indexed event reads", () => {
    const ref: EventRef = {
      type: "event",
      event_type: "Morpho_Supply",
      filters: [{ field: "chainId", op: "eq", value: 137 }],
      field: "assets",
      aggregation: "sum",
    };

    expect(planIndexedEventRead(ref, 1000, 2000, 1).chainId).toBe(137);
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

    expect(planRawEventRead(ref, 1000, 2000)).toEqual({
      family: "raw",
      provider: "hypersync",
      chainId: 1,
      ref,
      startTimeMs: 1000,
      endTimeMs: 2000,
    });
  });
});
