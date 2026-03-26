import type {
  IndexedEventFetcher,
  IndexingDataClient,
  RawEventFetcher,
} from "../engine/fetcher.js";
import { EnvioClient } from "../envio/client.js";
import { HyperSyncClient } from "../hypersync/client.js";
import type { EventRef } from "../types/index.js";

/**
 * Unified indexing/history boundary for the engine runtime.
 *
 * Sentinel currently uses:
 * - Envio for indexed semantic reads
 * - HyperSync for raw decoded log scans
 *
 * Keeping them behind one boundary lets the engine talk about indexed vs raw
 * data families without scattering provider-specific construction logic.
 */
export class IndexingClient implements IndexingDataClient {
  readonly fetchRawEvents?: IndexingDataClient["fetchRawEvents"];

  constructor(
    private readonly indexedFetcher: IndexedEventFetcher = new EnvioClient(),
    rawEventFetcher?: RawEventFetcher,
  ) {
    if (rawEventFetcher) {
      this.fetchRawEvents = (ref, startTimeMs, endTimeMs) =>
        rawEventFetcher.fetchRawEvents(ref, startTimeMs, endTimeMs);
    }
  }

  fetchEvents(ref: EventRef, startTimeMs: number, endTimeMs: number): Promise<number> {
    return this.indexedFetcher.fetchEvents(ref, startTimeMs, endTimeMs);
  }
}

export function createIndexingClient(
  indexedFetcher: IndexedEventFetcher = new EnvioClient(),
  rawEventFetcher: RawEventFetcher = new HyperSyncClient(),
): IndexingDataClient {
  return new IndexingClient(indexedFetcher, rawEventFetcher);
}
