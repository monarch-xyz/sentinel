/**
 * MorphoDataFetcher - Morpho Blue specific implementation of DataFetcher
 *
 * Uses RPC for all state queries and the unified indexing boundary for
 * historical/indexed data:
 * - State: RPC eth_call
 * - Indexed metrics/entities: indexing client (currently Envio)
 * - Raw decoded event scans: indexing client (currently HyperSync)
 */

import { resolveBlockByTimestamp } from "../envio/blocks.js";
import { executeArchiveRpcCall } from "../rpc/index.js";
import type { EventRef, RawEventRef, StateRef } from "../types/index.js";
import { requireBigIntTuple, requireSafeNumberFromBigInt } from "../utils/bigint-tuples.js";
import { createLogger } from "../utils/logger.js";
import type { DataFetcher, DataFetcherOptions, IndexingDataClient } from "./fetcher.js";
import { bindArchiveRpcExecution } from "./rpc-state-resolver.js";
import { planGenericRpcStateRead, planIndexedEventRead, planRawEventRead } from "./source-plan.js";

const logger = createLogger("morpho-fetcher");

function extractPositionField(result: unknown, field: string): number {
  const [supplyShares, borrowShares, collateral] = requireBigIntTuple(result, 3, "position RPC");
  switch (field) {
    case "supplyShares":
      return requireSafeNumberFromBigInt(supplyShares, "position.supplyShares");
    case "borrowShares":
      return requireSafeNumberFromBigInt(borrowShares, "position.borrowShares");
    case "collateral":
      return requireSafeNumberFromBigInt(collateral, "position.collateral");
    default:
      throw new Error(`Unknown Position field: ${field}`);
  }
}

/**
 * Extract a field value from RPC Market result
 */
function extractMarketField(result: unknown, field: string): number {
  const [
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
  ] = requireBigIntTuple(result, 6, "market RPC");

  switch (field) {
    case "totalSupplyAssets":
      return requireSafeNumberFromBigInt(totalSupplyAssets, "market.totalSupplyAssets");
    case "totalSupplyShares":
      return requireSafeNumberFromBigInt(totalSupplyShares, "market.totalSupplyShares");
    case "totalBorrowAssets":
      return requireSafeNumberFromBigInt(totalBorrowAssets, "market.totalBorrowAssets");
    case "totalBorrowShares":
      return requireSafeNumberFromBigInt(totalBorrowShares, "market.totalBorrowShares");
    case "lastUpdate":
      return requireSafeNumberFromBigInt(lastUpdate, "market.lastUpdate");
    case "fee":
      return requireSafeNumberFromBigInt(fee, "market.fee");
    default:
      throw new Error(`Unknown Market field: ${field}`);
  }
}

/**
 * Create a Morpho-specific DataFetcher
 *
 * @param indexing - Unified indexing/history client
 * @param options - Fetcher options (chainId, verbose)
 */
export function createMorphoFetcher(
  indexing: IndexingDataClient,
  options: DataFetcherOptions,
): DataFetcher {
  const { chainId: defaultChainId, verbose = false } = options;
  const rawEventFetcher = indexing.fetchRawEvents;

  /**
   * Fetch current state from RPC (latest block)
   */
  async function fetchCurrentState(ref: StateRef): Promise<number> {
    const plannedRead = planGenericRpcStateRead(ref, undefined, defaultChainId);
    if (plannedRead.protocol !== "morpho") {
      throw new Error(
        `createMorphoFetcher only supports morpho protocol, got "${plannedRead.protocol}"`,
      );
    }
    const plan = bindArchiveRpcExecution(plannedRead);
    const morphoPlan = plan.call;

    if (verbose) {
      logger.info(
        {
          chainId: plan.chainId,
          family: plan.family,
          provider: plan.provider,
          signature: morphoPlan.signature,
        },
        "Fetching current state from RPC",
      );
    }

    const result = await executeArchiveRpcCall(plan.chainId, plan.call);
    if (plannedRead.ref.entity_type === "Position") {
      return extractPositionField(result, plannedRead.ref.field);
    }

    if (plannedRead.ref.entity_type === "Market") {
      return extractMarketField(result, plannedRead.ref.field);
    }

    throw new Error(`Unknown entity type for RPC: ${plannedRead.ref.entity_type}`);
  }

  /**
   * Fetch historical state from RPC at specific block
   */
  async function fetchHistoricalState(ref: StateRef, timestamp: number): Promise<number> {
    const plannedRead = planGenericRpcStateRead(ref, timestamp, defaultChainId);
    if (plannedRead.protocol !== "morpho") {
      throw new Error(
        `createMorphoFetcher only supports morpho protocol, got "${plannedRead.protocol}"`,
      );
    }
    const plan = bindArchiveRpcExecution(plannedRead);

    // Resolve timestamp to block number
    const blockNumber = await resolveBlockByTimestamp(plan.chainId, timestamp);

    if (verbose) {
      logger.info(
        {
          chainId: plan.chainId,
          blockNumber,
          timestamp,
          family: plan.family,
          provider: plan.provider,
          signature: plan.call.signature,
        },
        "Fetching historical state from RPC",
      );
    }

    const result = await executeArchiveRpcCall(plan.chainId, plan.call, BigInt(blockNumber));
    if (plannedRead.ref.entity_type === "Position") {
      return extractPositionField(result, plannedRead.ref.field);
    }

    if (plannedRead.ref.entity_type === "Market") {
      return extractMarketField(result, plannedRead.ref.field);
    }

    throw new Error(`Unknown entity type for RPC: ${plannedRead.ref.entity_type}`);
  }

  return {
    /**
     * Fetch state using RPC for both current and historical:
     * - timestamp === undefined → RPC latest block
     * - timestamp !== undefined → RPC at resolved block
     */
    fetchState: async (ref: StateRef, timestamp?: number): Promise<number> => {
      if (timestamp === undefined) {
        return fetchCurrentState(ref);
      }
      return fetchHistoricalState(ref, timestamp);
    },

    /**
     * Fetch indexed semantic events through the unified indexing boundary.
     */
    fetchEvents: async (ref: EventRef, startTimeMs: number, endTimeMs: number): Promise<number> => {
      const plan = planIndexedEventRead(ref, startTimeMs, endTimeMs, defaultChainId);
      if (verbose) {
        logger.info(
          {
            eventType: plan.ref.event_type,
            field: plan.ref.field,
            aggregation: plan.ref.aggregation,
            chainId: plan.chainId,
            family: plan.family,
            provider: plan.provider,
          },
          "Fetching indexed events from indexing client",
        );
      }
      return indexing.fetchEvents(plan.ref, plan.startTimeMs, plan.endTimeMs);
    },

    fetchRawEvents: rawEventFetcher
      ? async (ref: RawEventRef, startTimeMs: number, endTimeMs: number): Promise<number> => {
          const plan = planRawEventRead(ref, startTimeMs, endTimeMs);
          if (verbose) {
            logger.info(
              {
                chainId: plan.chainId,
                family: plan.family,
                provider: plan.provider,
                aggregation: plan.ref.aggregation,
                queryCount: plan.ref.queries.length,
                signature: plan.ref.queries[0]?.eventSignature,
              },
              "Fetching raw events from indexing client",
            );
          }
          return rawEventFetcher(plan.ref, plan.startTimeMs, plan.endTimeMs);
        }
      : undefined,
  };
}
