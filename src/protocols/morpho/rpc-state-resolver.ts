import { isAddress } from "viem";
import { z } from "zod";
import type {
  PlannedArchiveRpcExecution,
  PlannedGenericRpcStateRead,
} from "../../engine/source-plan.ts";
import { planGenericRpcStateRead } from "../../engine/source-plan.ts";
import { MORPHO_ADDRESSES } from "../../rpc/abi.ts";
import type { Filter } from "../../types/index.ts";
import { normalizeMarketId } from "../../utils/market.ts";
import { buildMorphoMarketCall, buildMorphoPositionCall } from "./rpc-calls.ts";

type FilterValue = string | number | boolean;
type MorphoEntityType = "Position" | "Market";
const MorphoUserSchema = z.string().refine((value) => isAddress(value), {
  message: "Expected a valid EVM address",
});
const MorphoMarketIdSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/i, "Expected a bytes32 hex value (0x + 64 hex chars)");

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

function getEqFilterValue(filters: Filter[], field: string): FilterValue | undefined {
  const match = filters.find((filter) => filter.field === field && filter.op === "eq");
  return match?.value as FilterValue | undefined;
}

function requireStringFilterValue(
  filters: Filter[],
  field: string,
  requiredMessage: string,
): string {
  const value = getEqFilterValue(filters, field);
  if (value === undefined || value === "") {
    throw new Error(requiredMessage);
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field} filter value "${String(value)}": Expected a string`);
  }
  return value;
}

function parseMorphoEntityType(entityType: string): MorphoEntityType {
  if (entityType === "Position" || entityType === "Market") {
    return entityType;
  }

  throw new Error(
    `Unsupported Morpho entity type "${entityType}". Supported types: Position, Market.`,
  );
}

function requireBoundUser(plan: PlannedMorphoRpcStateRead): string {
  if (typeof plan.user !== "string" || plan.user.length === 0) {
    throw new Error("user filter required for Position queries");
  }
  return plan.user;
}

function requireMarketId(filters: Filter[]): string {
  const marketId = requireStringFilterValue(
    filters,
    "marketId",
    "marketId filter required for state queries",
  );
  const normalizedMarketId = normalizeMarketId(marketId);
  const parsedMarketId = MorphoMarketIdSchema.safeParse(normalizedMarketId);
  if (!parsedMarketId.success) {
    throw new Error(
      `Invalid marketId filter value "${marketId}": ${parsedMarketId.error.issues[0]?.message}`,
    );
  }
  return parsedMarketId.data;
}

function requireUser(filters: Filter[]): string {
  const user = requireStringFilterValue(
    filters,
    "user",
    "user filter required for Position queries",
  );
  const parsedUser = MorphoUserSchema.safeParse(user);
  if (!parsedUser.success) {
    throw new Error(`Invalid user filter value "${user}": ${parsedUser.error.issues[0]?.message}`);
  }
  return parsedUser.data;
}

export function planMorphoStateRead(
  ref: PlannedGenericRpcStateRead["ref"],
  timestamp: number | undefined,
  defaultChainId: number,
): PlannedMorphoRpcStateRead {
  const morphoRef = ref.protocol === undefined ? { ...ref, protocol: "morpho" } : ref;
  return bindMorphoRpcStateRead(planGenericRpcStateRead(morphoRef, timestamp, defaultChainId));
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
  const entityType = parseMorphoEntityType(plan.ref.entity_type);

  return {
    family: plan.family,
    provider: plan.provider,
    protocol: "morpho",
    chainId: plan.chainId,
    entityType,
    field: plan.ref.field,
    marketId: requireMarketId(plan.ref.filters),
    user: entityType === "Position" ? requireUser(plan.ref.filters) : undefined,
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
      call: buildMorphoPositionCall(address, bound.marketId, requireBoundUser(bound)),
    };
  }

  if (bound.entityType === "Market") {
    return {
      family: bound.family,
      provider: bound.provider,
      chainId: bound.chainId,
      timestamp: bound.timestamp,
      call: buildMorphoMarketCall(address, bound.marketId),
    };
  }

  throw new Error(`Unknown entity type for RPC: ${bound.entityType}`);
}
