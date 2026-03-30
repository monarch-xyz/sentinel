import { describe, expect, it, vi } from "vitest";
import type { IndexedEventFetcher, RawEventFetcher } from "../../src/engine/fetcher.ts";
import { IndexingClient, createIndexingClient } from "../../src/indexing/client.ts";
import type { EventRef, RawEventRef } from "../../src/types/index.ts";

describe("createIndexingClient", () => {
  it("forwards indexed semantic reads and raw event reads through one boundary", async () => {
    const indexedFetcher: IndexedEventFetcher = {
      fetchEvents: vi.fn().mockResolvedValue(111),
    };
    const rawEventFetcher: RawEventFetcher = {
      fetchRawEvents: vi.fn().mockResolvedValue(222),
    };

    const client = createIndexingClient(indexedFetcher, rawEventFetcher);

    const indexedRef: EventRef = {
      type: "event",
      event_type: "Supply",
      filters: [],
      field: "assets",
      aggregation: "sum",
    };
    const rawRef: RawEventRef = {
      type: "raw_event",
      source: "hypersync",
      chainId: 1,
      queries: [
        {
          eventSignature: "event Transfer(address indexed from, address indexed to, uint256 value)",
          topic0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          normalizer: "none",
        },
      ],
      field: "value",
      aggregation: "sum",
    };

    await expect(client.fetchEvents(indexedRef, 1000, 2000)).resolves.toBe(111);
    await expect(client.fetchRawEvents?.(rawRef, 1000, 2000)).resolves.toBe(222);

    expect(indexedFetcher.fetchEvents).toHaveBeenCalledWith(indexedRef, 1000, 2000);
    expect(rawEventFetcher.fetchRawEvents).toHaveBeenCalledWith(rawRef, 1000, 2000);
  });

  it("fails clearly when a fetcher family is unavailable", async () => {
    const client = new IndexingClient(undefined, undefined);

    const indexedRef: EventRef = {
      type: "event",
      event_type: "Supply",
      filters: [],
      field: "assets",
      aggregation: "sum",
    };
    await expect(client.fetchEvents(indexedRef, 1000, 2000)).rejects.toMatchObject({
      family: "indexed",
      provider: "envio",
    });

    expect(client.fetchRawEvents).toBeUndefined();
  });
});
