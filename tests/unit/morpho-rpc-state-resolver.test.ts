import { describe, expect, it } from "vitest";
import { planGenericRpcStateRead } from "../../src/engine/source-plan.js";
import {
  bindMorphoArchiveRpcExecution,
  bindMorphoRpcStateRead,
  planMorphoStateRead,
  planRpcStateRead,
} from "../../src/protocols/morpho/index.js";
import type { StateRef } from "../../src/types/index.js";

describe("morpho rpc state resolver", () => {
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

  it("binds generic state reads to a generic archive RPC call representation", () => {
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
          { type: "bytes32", value: "0xmarket" },
          { type: "address", value: "0xuser" },
        ],
      },
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

  it("fails clearly on unknown Morpho state names", () => {
    const ref: StateRef = {
      type: "state",
      entity_type: "Vault",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "assets",
    };

    expect(() => bindMorphoArchiveRpcExecution(planGenericRpcStateRead(ref, undefined, 1))).toThrow(
      "Unknown entity type for RPC: Vault",
    );
  });
});
