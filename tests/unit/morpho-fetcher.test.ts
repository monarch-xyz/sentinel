import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventFetcher, RawEventFetcher } from "../../src/engine/fetcher.js";
import { createMorphoFetcher } from "../../src/engine/morpho-fetcher.js";
import { resolveBlockByTimestamp } from "../../src/envio/blocks.js";
import {
  readMarket,
  readMarketAtBlock,
  readPosition,
  readPositionAtBlock,
} from "../../src/rpc/index.js";
import type { EventRef, RawEventRef, StateRef } from "../../src/types/index.js";

vi.mock("../../src/envio/blocks.js", () => ({
  resolveBlockByTimestamp: vi.fn(),
}));

vi.mock("../../src/rpc/index.js", () => ({
  readMarket: vi.fn(),
  readMarketAtBlock: vi.fn(),
  readPosition: vi.fn(),
  readPositionAtBlock: vi.fn(),
}));

describe("createMorphoFetcher", () => {
  const mockedResolveBlockByTimestamp = vi.mocked(resolveBlockByTimestamp);
  const mockedReadPosition = vi.mocked(readPosition);
  const mockedReadPositionAtBlock = vi.mocked(readPositionAtBlock);
  const mockedReadMarket = vi.mocked(readMarket);
  const mockedReadMarketAtBlock = vi.mocked(readMarketAtBlock);

  const eventFetcher: EventFetcher = {
    fetchEvents: vi.fn(),
  };

  const positionRef: StateRef = {
    type: "state",
    entity_type: "Position",
    filters: [
      { field: "marketId", op: "eq", value: "0xmarket" },
      { field: "user", op: "eq", value: "0xuser" },
    ],
    field: "supplyShares",
  };

  const marketRef: StateRef = {
    type: "state",
    entity_type: "Market",
    filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
    field: "totalBorrowAssets",
  };

  const eventRef: EventRef = {
    type: "event",
    event_type: "Supply",
    filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
    field: "assets",
    aggregation: "sum",
  };

  const rawEventRef: RawEventRef = {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes current position state to readPosition", async () => {
    mockedReadPosition.mockResolvedValue({
      supplyShares: 123n,
      borrowShares: 0n,
      collateral: 0n,
    });
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });

    const value = await fetcher.fetchState(positionRef);

    expect(value).toBe(123);
    expect(mockedReadPosition).toHaveBeenCalledWith(1, "0xmarket", "0xuser");
    expect(mockedReadPositionAtBlock).not.toHaveBeenCalled();
  });

  it("routes historical market state to resolveBlockByTimestamp + readMarketAtBlock", async () => {
    mockedResolveBlockByTimestamp.mockResolvedValue(19001234);
    mockedReadMarketAtBlock.mockResolvedValue({
      totalSupplyAssets: 0n,
      totalSupplyShares: 0n,
      totalBorrowAssets: 456n,
      totalBorrowShares: 0n,
      lastUpdate: 0n,
      fee: 0n,
    });
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });

    const value = await fetcher.fetchState(marketRef, 1700000000000);

    expect(value).toBe(456);
    expect(mockedResolveBlockByTimestamp).toHaveBeenCalledWith(1, 1700000000000);
    expect(mockedReadMarketAtBlock).toHaveBeenCalledWith(1, "0xmarket", 19001234n);
    expect(mockedReadMarket).not.toHaveBeenCalled();
  });

  it("forwards event queries to the event fetcher unchanged", async () => {
    const fetchEventsMock = vi
      .fn<Parameters<EventFetcher["fetchEvents"]>, ReturnType<EventFetcher["fetchEvents"]>>()
      .mockResolvedValue(999);
    const fetcher = createMorphoFetcher({ fetchEvents: fetchEventsMock }, { chainId: 1 });

    const value = await fetcher.fetchEvents(eventRef, 1000, 2000);

    expect(value).toBe(999);
    expect(fetchEventsMock).toHaveBeenCalledWith(eventRef, 1000, 2000);
  });

  it("uses chainId filter override when present", async () => {
    mockedReadMarket.mockResolvedValue({
      totalSupplyAssets: 0n,
      totalSupplyShares: 0n,
      totalBorrowAssets: 777n,
      totalBorrowShares: 0n,
      lastUpdate: 0n,
      fee: 0n,
    });
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });
    const refWithChainOverride: StateRef = {
      ...marketRef,
      filters: [...marketRef.filters, { field: "chainId", op: "eq", value: 8453 }],
    };

    const value = await fetcher.fetchState(refWithChainOverride);

    expect(value).toBe(777);
    expect(mockedReadMarket).toHaveBeenCalledWith(8453, "0xmarket");
  });

  it("throws clear error when required filters are missing", async () => {
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });
    const missingMarket: StateRef = {
      type: "state",
      entity_type: "Market",
      filters: [],
      field: "totalBorrowAssets",
    };

    await expect(fetcher.fetchState(missingMarket)).rejects.toThrow(
      "marketId filter required for state queries",
    );
  });

  it("throws clear error when Position user filter is missing", async () => {
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });
    const missingUser: StateRef = {
      type: "state",
      entity_type: "Position",
      filters: [{ field: "marketId", op: "eq", value: "0xmarket" }],
      field: "supplyShares",
    };

    await expect(fetcher.fetchState(missingUser)).rejects.toThrow(
      "user filter required for Position queries",
    );
  });

  it("forwards raw event queries when a raw event fetcher is configured", async () => {
    const rawEventFetcher: RawEventFetcher = {
      fetchRawEvents: vi.fn().mockResolvedValue(321),
    };
    const fetcher = createMorphoFetcher(
      { ...eventFetcher, fetchRawEvents: rawEventFetcher.fetchRawEvents },
      { chainId: 1 },
    );

    const value = await fetcher.fetchRawEvents?.(rawEventRef, 1000, 2000);

    expect(value).toBe(321);
    expect(rawEventFetcher.fetchRawEvents).toHaveBeenCalledWith(rawEventRef, 1000, 2000);
  });
});
