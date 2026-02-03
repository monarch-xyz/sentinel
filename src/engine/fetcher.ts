/**
 * DataFetcher - Protocol-agnostic interface for fetching blockchain state
 *
 * This interface decouples the evaluation engine from specific data sources.
 * Protocol-specific implementations (e.g., MorphoDataFetcher) handle the
 * actual data fetching logic.
 */

import { StateRef, EventRef } from '../types/index.js';

/**
 * Interface for fetching state and event data
 */
export type DataFetcher = {
  /**
   * Fetch state at a specific point in time
   *
   * @param ref - StateRef describing what to fetch (entity, field, filters)
   * @param timestamp - Unix timestamp in ms, or undefined for current state
   * @returns The numeric value of the requested field
   */
  fetchState: (ref: StateRef, timestamp?: number) => Promise<number>;

  /**
   * Fetch and aggregate events over a time window
   *
   * @param ref - EventRef describing what to fetch (event type, field, aggregation)
   * @param startTimeMs - Start of time window (unix timestamp in ms)
   * @param endTimeMs - End of time window (unix timestamp in ms)
   * @returns The aggregated numeric value
   */
  fetchEvents: (ref: EventRef, startTimeMs: number, endTimeMs: number) => Promise<number>;
};

/**
 * Options for creating a DataFetcher
 */
export type DataFetcherOptions = {
  /** Chain ID for this fetcher instance */
  chainId: number;
  /** Enable verbose logging */
  verbose?: boolean;
};
