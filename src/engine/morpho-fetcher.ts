/**
 * MorphoDataFetcher - Morpho Blue specific implementation of DataFetcher
 *
 * Uses a hybrid approach:
 * - Current state: Envio GraphQL (fast, indexed)
 * - Historical state: RPC eth_call (Envio doesn't support time-travel)
 * - Events: Envio GraphQL (events have timestamps, no time-travel needed)
 */

import { StateRef, EventRef } from '../types/index.js';
import { EnvioClient } from '../envio/client.js';
import { resolveBlockByTimestamp } from '../envio/blocks.js';
import {
  readPositionAtBlock,
  readMarketAtBlock,
  type PositionResult,
  type MarketResult,
} from '../rpc/index.js';
import type { DataFetcher, DataFetcherOptions } from './fetcher.js';
import pino from 'pino';

const pinoFactory = (pino as unknown as { default: typeof pino }).default ?? pino;
const logger = pinoFactory({ name: 'morpho-fetcher' });

/**
 * Extract a field value from RPC Position result
 */
function extractPositionField(result: PositionResult, field: string): number {
  switch (field) {
    case 'supplyShares':
      return Number(result.supplyShares);
    case 'borrowShares':
      return Number(result.borrowShares);
    case 'collateral':
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
    case 'totalSupplyAssets':
      return Number(result.totalSupplyAssets);
    case 'totalSupplyShares':
      return Number(result.totalSupplyShares);
    case 'totalBorrowAssets':
      return Number(result.totalBorrowAssets);
    case 'totalBorrowShares':
      return Number(result.totalBorrowShares);
    case 'lastUpdate':
      return Number(result.lastUpdate);
    case 'fee':
      return Number(result.fee);
    default:
      throw new Error(`Unknown Market field: ${field}`);
  }
}

/**
 * Extract filter values from StateRef
 */
function extractFilters(ref: StateRef): { chainId?: number; marketId?: string; user?: string } {
  const result: { chainId?: number; marketId?: string; user?: string } = {};
  for (const filter of ref.filters) {
    if (filter.field === 'chainId' && filter.op === 'eq') {
      result.chainId = Number(filter.value);
    } else if (filter.field === 'marketId' && filter.op === 'eq') {
      result.marketId = String(filter.value);
    } else if (filter.field === 'user' && filter.op === 'eq') {
      result.user = String(filter.value);
    }
  }
  return result;
}

/**
 * Create a Morpho-specific DataFetcher
 *
 * @param envio - EnvioClient instance for current state and events
 * @param options - Fetcher options (chainId, verbose)
 */
export function createMorphoFetcher(envio: EnvioClient, options: DataFetcherOptions): DataFetcher {
  const { chainId: defaultChainId, verbose = false } = options;

  /**
   * Fetch current state from Envio
   */
  async function fetchCurrentState(ref: StateRef): Promise<number> {
    if (verbose) {
      logger.info({ entity: ref.entity_type, field: ref.field }, 'Fetching current state from Envio');
    }
    return envio.fetchState(ref);
  }

  /**
   * Fetch historical state from RPC
   */
  async function fetchHistoricalState(ref: StateRef, timestamp: number): Promise<number> {
    const filters = extractFilters(ref);
    const chainId = filters.chainId ?? defaultChainId;
    const marketId = filters.marketId;

    if (!marketId) {
      throw new Error('marketId filter required for historical state queries');
    }

    // Resolve timestamp to block number
    const blockNumber = await resolveBlockByTimestamp(chainId, timestamp);

    if (verbose) {
      logger.info(
        { entity: ref.entity_type, field: ref.field, chainId, blockNumber, timestamp },
        'Fetching historical state from RPC'
      );
    }

    if (ref.entity_type === 'Position') {
      const user = filters.user;
      if (!user) {
        throw new Error('user filter required for Position queries');
      }
      const result = await readPositionAtBlock(chainId, marketId, user, BigInt(blockNumber));
      return extractPositionField(result, ref.field);
    }

    if (ref.entity_type === 'Market') {
      const result = await readMarketAtBlock(chainId, marketId, BigInt(blockNumber));
      return extractMarketField(result, ref.field);
    }

    throw new Error(`Unknown entity type for RPC: ${ref.entity_type}`);
  }

  return {
    /**
     * Fetch state using hybrid approach:
     * - timestamp === undefined → Envio (current state)
     * - timestamp !== undefined → RPC (historical state)
     */
    fetchState: async (ref: StateRef, timestamp?: number): Promise<number> => {
      if (timestamp === undefined) {
        return fetchCurrentState(ref);
      }
      return fetchHistoricalState(ref, timestamp);
    },

    /**
     * Fetch events from Envio (events have timestamps, no time-travel needed)
     */
    fetchEvents: async (ref: EventRef, startTimeMs: number, endTimeMs: number): Promise<number> => {
      if (verbose) {
        logger.info(
          { eventType: ref.event_type, field: ref.field, aggregation: ref.aggregation },
          'Fetching events from Envio'
        );
      }
      return envio.fetchEvents(ref, startTimeMs, endTimeMs);
    },
  };
}
