import { describe, expect, it } from "vitest";
import { bindArchiveRpcExecution } from "../../src/engine/rpc-state-resolver.ts";
import { planGenericRpcStateRead } from "../../src/engine/source-plan.ts";
import {
  bindMorphoArchiveRpcExecution,
  bindMorphoRpcStateRead,
  planMorphoStateRead,
  planRpcStateRead,
} from "../../src/protocols/morpho/index.ts";
import type { StateRef } from "../../src/types/index.ts";

describe("morpho rpc state resolver", () => {
  const MARKET_ID = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const USER = "0x2222222222222222222222222222222222222222" as const;

  it("binds generic state reads to Morpho runtime requirements", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Position",
      filters: [
        { field: "chainId", op: "eq", value: 8453 },
        { field: "marketId", op: "eq", value: MARKET_ID },
        { field: "user", op: "eq", value: USER },
      ],
      field: "supplyShares",
    };
    const plannedRead = planGenericRpcStateRead(ref, 1700000000000, 1);

    expect(bindMorphoRpcStateRead(plannedRead)).toEqual({
      family: "state",
      provider: "rpc",
      protocol: "morpho",
      chainId: 8453,
      entityType: "Position",
      field: "supplyShares",
      marketId: MARKET_ID,
      user: USER,
      timestamp: 1700000000000,
    });
  });

  it("binds generic state reads to a generic archive RPC call representation", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Position",
      filters: [
        { field: "chainId", op: "eq", value: 8453 },
        { field: "marketId", op: "eq", value: MARKET_ID },
        { field: "user", op: "eq", value: USER },
      ],
      field: "supplyShares",
    };

    expect(bindMorphoArchiveRpcExecution(planGenericRpcStateRead(ref, undefined, 1))).toEqual({
      family: "state",
      provider: "rpc",
      chainId: 8453,
      timestamp: undefined,
      call: {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature:
          "position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
        args: [
          { type: "bytes32", value: MARKET_ID },
          { type: "address", value: USER },
        ],
      },
    });
  });

  it("dispatches archive RPC binding using protocol discriminator", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: MARKET_ID }],
      field: "totalBorrowAssets",
    };

    expect(bindArchiveRpcExecution(planGenericRpcStateRead(ref, undefined, 1))).toEqual(
      bindMorphoArchiveRpcExecution(planGenericRpcStateRead(ref, undefined, 1)),
    );
  });

  it("preserves legacy Morpho state planner behavior", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Position",
      filters: [
        { field: "chainId", op: "eq", value: 8453 },
        { field: "marketId", op: "eq", value: MARKET_ID },
        { field: "user", op: "eq", value: USER },
      ],
      field: "supplyShares",
    };

    expect(planMorphoStateRead(ref, 1700000000000, 1)).toEqual({
      family: "state",
      provider: "rpc",
      protocol: "morpho",
      chainId: 8453,
      entityType: "Position",
      field: "supplyShares",
      marketId: MARKET_ID,
      user: USER,
      timestamp: 1700000000000,
    });
  });

  it("rejects missing market filters when binding Morpho state reads", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
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
      protocol: "morpho",
      entity_type: "Position",
      filters: [{ field: "marketId", op: "eq", value: MARKET_ID }],
      field: "supplyShares",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      "user filter required for Position queries",
    );
  });

  it("rejects invalid marketId filters at the resolver boundary", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: "0xnot-bytes32" }],
      field: "totalBorrowAssets",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      'Invalid marketId filter value "0xnot-bytes32": Expected a bytes32 hex value (0x + 64 hex chars)',
    );
  });

  it("rejects invalid user filters at the resolver boundary", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Position",
      filters: [
        { field: "marketId", op: "eq", value: MARKET_ID },
        { field: "user", op: "eq", value: "0xnot-an-address" },
      ],
      field: "supplyShares",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      'Invalid user filter value "0xnot-an-address": Expected a valid EVM address',
    );
  });

  it("keeps legacy planRpcStateRead behavior for compatibility", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Position",
      filters: [
        { field: "chainId", op: "eq", value: 8453 },
        { field: "marketId", op: "eq", value: MARKET_ID },
        { field: "user", op: "eq", value: USER },
      ],
      field: "supplyShares",
    };

    expect(planRpcStateRead(ref, 1700000000000, 1)).toEqual({
      family: "state",
      provider: "rpc",
      protocol: "morpho",
      chainId: 8453,
      entityType: "Position",
      field: "supplyShares",
      marketId: MARKET_ID,
      user: USER,
      timestamp: 1700000000000,
    });
  });

  it("fails clearly on unknown Morpho state names", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Vault",
      filters: [{ field: "marketId", op: "eq", value: MARKET_ID }],
      field: "assets",
    };

    expect(() => bindMorphoArchiveRpcExecution(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      'Unsupported Morpho entity type "Vault". Supported types: Position, Market.',
    );
  });

  it("rejects non-morpho protocol plans", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "aave",
      entity_type: "Position",
      filters: [
        { field: "chainId", op: "eq", value: 8453 },
        { field: "marketId", op: "eq", value: MARKET_ID },
        { field: "user", op: "eq", value: USER },
      ],
      field: "supplyShares",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      "Morpho binder received incompatible protocol: aave",
    );
  });

  it("rejects unsupported protocols in archive dispatcher", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "aave",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: MARKET_ID }],
      field: "totalBorrowAssets",
    };

    expect(() => bindArchiveRpcExecution(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      "Unsupported state protocol for RPC: aave",
    );
  });

  it("rejects non-string marketId filter values before format validation", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Market",
      filters: [{ field: "marketId", op: "eq", value: true }],
      field: "totalBorrowAssets",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      'Invalid marketId filter value "true": Expected a string',
    );
  });

  it("rejects non-string user filter values before address validation", () => {
    const ref: StateRef = {
      type: "state",
      protocol: "morpho",
      entity_type: "Position",
      filters: [
        { field: "marketId", op: "eq", value: MARKET_ID },
        { field: "user", op: "eq", value: 123 },
      ],
      field: "supplyShares",
    };

    expect(() => bindMorphoRpcStateRead(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      'Invalid user filter value "123": Expected a string',
    );
  });
});
