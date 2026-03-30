import type {
  PlannedArchiveRpcExecution,
  PlannedGenericRpcStateRead,
} from "../../engine/source-plan.js";
import { planGenericRpcStateRead } from "../../engine/source-plan.js";
import { MORPHO_ADDRESSES } from "../../rpc/abi.js";
import type { Filter } from "../../types/index.js";
import { normalizeMarketId } from "../../utils/market.js";

type FilterValue = string | number | boolean;

export interface PlannedMorphoRpcStateRead {
  family: "state";
  provider: "rpc";
  protocol: "morpho";
  chainId: number;
  entityType: string;
  field: string;
  marketId: string;
  user?: string;
  timestamp?: number;
}

/**
 * Backward-compatible Morpho-shaped RPC plan.
 *
 * @deprecated Use `PlannedGenericRpcStateRead` + `bindMorphoRpcStateRead`.
 */
export type PlannedRpcStateRead = PlannedMorphoRpcStateRead;

function getEqFilterValue<T extends FilterValue>(filters: Filter[], field: string): T | undefined {
  const match = filters.find((filter) => filter.field === field && filter.op === "eq");
  return match?.value as T | undefined;
}

function requireMarketId(filters: Filter[]): string {
  const marketId = getEqFilterValue<string>(filters, "marketId");
  if (!marketId) {
    throw new Error("marketId filter required for state queries");
  }
  return normalizeMarketId(marketId);
}

function requireUser(filters: Filter[]): string {
  const user = getEqFilterValue<string>(filters, "user");
  if (!user) {
    throw new Error("user filter required for Position queries");
  }
  return user;
}

export function planMorphoStateRead(
  ref: PlannedGenericRpcStateRead["ref"],
  timestamp: number | undefined,
  defaultChainId: number,
): PlannedMorphoRpcStateRead {
  return bindMorphoRpcStateRead(planGenericRpcStateRead(ref, timestamp, defaultChainId));
}

/**
 * @deprecated Use `planGenericRpcStateRead` + `bindMorphoRpcStateRead` directly.
 */
export function planRpcStateRead(
  ref: PlannedGenericRpcStateRead["ref"],
  timestamp: number | undefined,
  defaultChainId: number,
): PlannedRpcStateRead {
  return planMorphoStateRead(ref, timestamp, defaultChainId);
}

export function bindMorphoRpcStateRead(
  plan: PlannedGenericRpcStateRead,
): PlannedMorphoRpcStateRead {
  if (plan.protocol !== "morpho") {
    throw new Error(`Morpho binder received incompatible protocol: ${plan.protocol}`);
  }

  return {
    family: plan.family,
    provider: plan.provider,
    protocol: "morpho",
    chainId: plan.chainId,
    entityType: plan.ref.entity_type,
    field: plan.ref.field,
    marketId: requireMarketId(plan.ref.filters),
    user: plan.ref.entity_type === "Position" ? requireUser(plan.ref.filters) : undefined,
    timestamp: plan.timestamp,
  };
}

export function bindMorphoArchiveRpcExecution(
  plan: PlannedGenericRpcStateRead,
): PlannedArchiveRpcExecution {
  const bound = bindMorphoRpcStateRead(plan);
  const address = MORPHO_ADDRESSES[bound.chainId];
  if (!address) {
    throw new Error(`Morpho not deployed on chain ${bound.chainId}`);
  }

  if (bound.entityType === "Position") {
    return {
      family: bound.family,
      provider: bound.provider,
      chainId: bound.chainId,
      timestamp: bound.timestamp,
      call: {
        to: address,
        signature:
          "position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
        args: [
          { type: "bytes32", value: bound.marketId },
          { type: "address", value: bound.user as string },
        ],
      },
    };
  }

  if (bound.entityType === "Market") {
    return {
      family: bound.family,
      provider: bound.provider,
      chainId: bound.chainId,
      timestamp: bound.timestamp,
      call: {
        to: address,
        signature:
          "market(bytes32 id) returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
        args: [{ type: "bytes32", value: bound.marketId }],
      },
    };
  }

  throw new Error(`Unknown entity type for RPC: ${bound.entityType}`);
}
