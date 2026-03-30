/**
 * DataFetcher - Protocol-agnostic interface for fetching blockchain state
 *
 * This interface decouples the evaluation engine from specific data sources.
 * Protocol-specific implementations (e.g., MorphoDataFetcher) handle the
 * actual data fetching logic across the three canonical data families:
 * - state / historical state
 * - indexed entities + indexed event metrics
 * - raw decoded event scans
 */

import type { EventRef, RawEventRef, StateRef } from "../types/index.ts";

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

  /**
   * Fetch and aggregate raw decoded logs over a time window.
   */
  fetchRawEvents?: (ref: RawEventRef, startTimeMs: number, endTimeMs: number) => Promise<number>;
};

/**
 * Minimal interface for indexed event/entity history fetchers.
 *
 * The current implementation is Envio-backed, but the engine should think in
 * terms of indexed history rather than a specific provider.
 */
export type IndexedEventFetcher = {
  fetchEvents: (ref: EventRef, startTimeMs: number, endTimeMs: number) => Promise<number>;
};

/**
 * Backward-compatible alias used by older tests and call sites.
 */
export type EventFetcher = IndexedEventFetcher;

export type RawEventFetcher = {
  fetchRawEvents: (ref: RawEventRef, startTimeMs: number, endTimeMs: number) => Promise<number>;
};

/**
 * Unified historical/indexing boundary used by protocol fetchers.
 *
 * This composes indexed semantic reads (currently Envio) and raw decoded log
 * reads (currently HyperSync) behind one engine-facing interface.
 */
export type IndexingDataClient = IndexedEventFetcher & Partial<RawEventFetcher>;

/**
 * Options for creating a DataFetcher
 */
export type DataFetcherOptions = {
  /** Chain ID for this fetcher instance */
  chainId: number;
  /** Enable verbose logging */
  verbose?: boolean;
};
