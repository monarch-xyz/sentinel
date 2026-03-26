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
import {
  type MarketResult,
  type PositionResult,
  readMarket,
  readMarketAtBlock,
  readPosition,
  readPositionAtBlock,
} from "../rpc/index.js";
import type { EventRef, RawEventRef, StateRef } from "../types/index.js";
import { createLogger } from "../utils/logger.js";
import type { DataFetcher, DataFetcherOptions, IndexingDataClient } from "./fetcher.js";
import { planMorphoEventRead, planMorphoRawEventRead, planMorphoStateRead } from "./source-plan.js";

const logger = createLogger("morpho-fetcher");

/**
 * Extract a field value from RPC Position result
 */
function extractPositionField(result: PositionResult, field: string): number {
  switch (field) {
    case "supplyShares":
      return Number(result.supplyShares);
    case "borrowShares":
      return Number(result.borrowShares);
    case "collateral":
      return Number(result.collateral);
    default:
      throw new Error(`Unknown Position field: ${field}`);
  }
}

/**
 * Extract a field value from RPC Market result
 */
function extractMarketField(result: MarketResult, field: string): number {
  switch (field) {
    case "totalSupplyAssets":
      return Number(result.totalSupplyAssets);
    case "totalSupplyShares":
      return Number(result.totalSupplyShares);
    case "totalBorrowAssets":
      return Number(result.totalBorrowAssets);
    case "totalBorrowShares":
      return Number(result.totalBorrowShares);
    case "lastUpdate":
      return Number(result.lastUpdate);
    case "fee":
      return Number(result.fee);
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
    const plan = planMorphoStateRead(ref, undefined, defaultChainId);

    if (verbose) {
      logger.info(
        {
          entity: plan.entityType,
          field: plan.field,
          chainId: plan.chainId,
          family: plan.family,
          provider: plan.provider,
        },
        "Fetching current state from RPC",
      );
    }

    if (plan.entityType === "Position") {
      const result = await readPosition(plan.chainId, plan.marketId, plan.user as string);
      return extractPositionField(result, plan.field);
    }

    if (plan.entityType === "Market") {
      const result = await readMarket(plan.chainId, plan.marketId);
      return extractMarketField(result, plan.field);
    }

    throw new Error(`Unknown entity type for RPC: ${plan.entityType}`);
  }

  /**
   * Fetch historical state from RPC at specific block
   */
  async function fetchHistoricalState(ref: StateRef, timestamp: number): Promise<number> {
    const plan = planMorphoStateRead(ref, timestamp, defaultChainId);

    // Resolve timestamp to block number
    const blockNumber = await resolveBlockByTimestamp(plan.chainId, timestamp);

    if (verbose) {
      logger.info(
        {
          entity: plan.entityType,
          field: plan.field,
          chainId: plan.chainId,
          blockNumber,
          timestamp,
          family: plan.family,
          provider: plan.provider,
        },
        "Fetching historical state from RPC",
      );
    }

    if (plan.entityType === "Position") {
      const result = await readPositionAtBlock(
        plan.chainId,
        plan.marketId,
        plan.user as string,
        BigInt(blockNumber),
      );
      return extractPositionField(result, plan.field);
    }

    if (plan.entityType === "Market") {
      const result = await readMarketAtBlock(plan.chainId, plan.marketId, BigInt(blockNumber));
      return extractMarketField(result, plan.field);
    }

    throw new Error(`Unknown entity type for RPC: ${plan.entityType}`);
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
      const plan = planMorphoEventRead(ref, startTimeMs, endTimeMs, defaultChainId);
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
          const plan = planMorphoRawEventRead(ref, startTimeMs, endTimeMs);
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
