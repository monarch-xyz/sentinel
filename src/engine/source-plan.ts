import { MORPHO_ADDRESSES } from "../rpc/abi.js";
import type { EventRef, Filter, GenericRpcCall, RawEventRef, StateRef } from "../types/index.js";
import { normalizeMarketId } from "../utils/market.js";

type FilterValue = string | number | boolean;

export interface PlannedGenericRpcStateRead {
  family: "state";
  provider: "rpc";
  chainId: number;
  ref: StateRef;
  timestamp?: number;
}

/**
 * Morpho-specific RPC read binding.
 *
 * This is intentionally derived from the generic `PlannedGenericRpcStateRead`
 * so protocol-specific requirements stay out of the primitive state plan.
 */
export interface PlannedMorphoRpcStateRead {
  family: "state";
  provider: "rpc";
  chainId: number;
  entityType: string;
  field: string;
  marketId: string;
  user?: string;
  timestamp?: number;
}

export interface PlannedGenericArchiveRpcExecution {
  family: "state";
  provider: "rpc";
  chainId: number;
  call: GenericRpcCall;
  timestamp?: number;
}

/**
 * Backward-compatible Morpho-shaped RPC plan.
 *
 * @deprecated Use `PlannedGenericRpcStateRead` + `bindMorphoRpcStateRead`.
 */
export type PlannedRpcStateRead = PlannedMorphoRpcStateRead;

export interface PlannedIndexedEventRead {
  family: "indexed";
  provider: "envio";
  chainId: number;
  ref: EventRef;
  startTimeMs: number;
  endTimeMs: number;
}

export interface PlannedRawEventRead {
  family: "raw";
  provider: "hypersync";
  chainId: number;
  ref: RawEventRef;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * Backward-compatible alias for older imports.
 */
export type PlannedEnvioEventRead = PlannedIndexedEventRead;

function getEqFilterValue<T extends FilterValue>(filters: Filter[], field: string): T | undefined {
  const match = filters.find((filter) => filter.field === field && filter.op === "eq");
  return match?.value as T | undefined;
}

function resolveChainId(filters: Filter[], defaultChainId: number): number {
  return Number(getEqFilterValue<number>(filters, "chainId") ?? defaultChainId);
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

/**
 * Centralized source planning keeps provider policy out of the evaluator.
 *
 * Today the Morpho runtime uses:
 * - RPC for state reads
 * - the indexing boundary for indexed semantic event reads
 * - the indexing boundary for raw decoded event reads
 *
 * Future providers should extend this planning layer rather than pushing
 * source decisions back into evaluator or route code.
 */
export function planMorphoStateRead(
  ref: StateRef,
  timestamp: number | undefined,
  defaultChainId: number,
): PlannedMorphoRpcStateRead {
  return bindMorphoRpcStateRead(planGenericRpcStateRead(ref, timestamp, defaultChainId));
}

export function planGenericRpcStateRead(
  ref: StateRef,
  timestamp: number | undefined,
  defaultChainId: number,
): PlannedGenericRpcStateRead {
  return {
    family: "state",
    provider: "rpc",
    chainId: resolveChainId(ref.filters, defaultChainId),
    ref,
    timestamp,
  };
}

/**
 * @deprecated Use `planGenericRpcStateRead` + `bindMorphoRpcStateRead` directly.
 */
export function planRpcStateRead(
  ref: StateRef,
  timestamp: number | undefined,
  defaultChainId: number,
): PlannedRpcStateRead {
  return bindMorphoRpcStateRead(planGenericRpcStateRead(ref, timestamp, defaultChainId));
}

export function bindMorphoRpcStateRead(
  plan: PlannedGenericRpcStateRead,
): PlannedMorphoRpcStateRead {
  return {
    family: plan.family,
    provider: plan.provider,
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
): PlannedGenericArchiveRpcExecution {
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

export function planMorphoEventRead(
  ref: EventRef,
  startTimeMs: number,
  endTimeMs: number,
  defaultChainId: number,
): PlannedIndexedEventRead {
  return {
    family: "indexed",
    provider: "envio",
    chainId: resolveChainId(ref.filters, defaultChainId),
    ref,
    startTimeMs,
    endTimeMs,
  };
}

export function planMorphoRawEventRead(
  ref: RawEventRef,
  startTimeMs: number,
  endTimeMs: number,
): PlannedRawEventRead {
  return {
    family: "raw",
    provider: "hypersync",
    chainId: ref.chainId,
    ref,
    startTimeMs,
    endTimeMs,
  };
}
