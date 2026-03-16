import type { EventRef, Filter, StateRef } from "../types/index.js";

type FilterValue = string | number | boolean;

export interface PlannedRpcStateRead {
  source: "rpc";
  chainId: number;
  entityType: StateRef["entity_type"];
  field: StateRef["field"];
  marketId: string;
  user?: string;
  timestamp?: number;
}

export interface PlannedEnvioEventRead {
  source: "envio";
  chainId: number;
  ref: EventRef;
  startTimeMs: number;
  endTimeMs: number;
}

function getEqFilterValue<T extends FilterValue>(
  filters: Filter[],
  field: string,
): T | undefined {
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
  return marketId;
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
 * - Envio for event reads
 *
 * Future providers should extend this planning layer rather than pushing
 * source decisions back into evaluator or route code.
 */
export function planMorphoStateRead(
  ref: StateRef,
  timestamp: number | undefined,
  defaultChainId: number,
): PlannedRpcStateRead {
  return {
    source: "rpc",
    chainId: resolveChainId(ref.filters, defaultChainId),
    entityType: ref.entity_type,
    field: ref.field,
    marketId: requireMarketId(ref.filters),
    user: ref.entity_type === "Position" ? requireUser(ref.filters) : undefined,
    timestamp,
  };
}

export function planMorphoEventRead(
  ref: EventRef,
  startTimeMs: number,
  endTimeMs: number,
  defaultChainId: number,
): PlannedEnvioEventRead {
  return {
    source: "envio",
    chainId: resolveChainId(ref.filters, defaultChainId),
    ref,
    startTimeMs,
    endTimeMs,
  };
}
