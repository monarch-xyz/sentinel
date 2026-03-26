import type {
  IndexedEventFetcher,
  IndexingDataClient,
  RawEventFetcher,
} from "../engine/fetcher.js";
import {
  createSourceCapabilityError,
  getSourceCapabilities,
} from "../engine/source-capabilities.js";
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
  readonly fetchRawEvents: NonNullable<IndexingDataClient["fetchRawEvents"]>;

  constructor(
    private readonly indexedFetcher?: IndexedEventFetcher,
    rawEventFetcher?: RawEventFetcher,
  ) {
    this.fetchRawEvents = async (ref, startTimeMs, endTimeMs) => {
      if (!rawEventFetcher) {
        throw createSourceCapabilityError("raw", "raw event fetcher is not configured");
      }

      return rawEventFetcher.fetchRawEvents(ref, startTimeMs, endTimeMs);
    };
  }

  async fetchEvents(ref: EventRef, startTimeMs: number, endTimeMs: number): Promise<number> {
    if (!this.indexedFetcher) {
      throw createSourceCapabilityError("indexed", "indexed fetcher is not configured");
    }

    return this.indexedFetcher.fetchEvents(ref, startTimeMs, endTimeMs);
  }
}

export function createIndexingClient(
  indexedFetcher?: IndexedEventFetcher,
  rawEventFetcher?: RawEventFetcher,
): IndexingDataClient {
  const capabilities = getSourceCapabilities();
  const resolvedIndexedFetcher =
    indexedFetcher ?? (capabilities.indexed.enabled ? new EnvioClient() : undefined);
  const resolvedRawEventFetcher =
    rawEventFetcher ?? (capabilities.raw.enabled ? new HyperSyncClient() : undefined);

  return new IndexingClient(resolvedIndexedFetcher, resolvedRawEventFetcher);
}
