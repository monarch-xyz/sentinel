import type { EventRef, Filter, GenericRpcCall, RawEventRef, StateRef } from "../types/index.js";

type FilterValue = string | number | boolean;

export interface PlannedGenericRpcStateRead {
  family: "state";
  provider: "rpc";
  chainId: number;
  ref: StateRef;
  timestamp?: number;
}

export interface PlannedArchiveRpcExecution {
  family: "state";
  provider: "rpc";
  chainId: number;
  call: GenericRpcCall;
  timestamp?: number;
}

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

/**
 * Generic state planner for archive RPC reads.
 */
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
 * Generic indexed event planner.
 */
export function planIndexedEventRead(
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

/**
 * Generic raw event planner.
 */
export function planRawEventRead(
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
