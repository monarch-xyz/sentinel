import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventFetcher, RawEventFetcher } from "../../src/engine/fetcher.js";
import { createMorphoFetcher } from "../../src/engine/morpho-fetcher.js";
import { resolveBlockByTimestamp } from "../../src/envio/blocks.js";
import { executeArchiveRpcCall } from "../../src/rpc/index.js";
import type { EventRef, RawEventRef, StateRef } from "../../src/types/index.js";

vi.mock("../../src/envio/blocks.js", () => ({
  resolveBlockByTimestamp: vi.fn(),
}));

vi.mock("../../src/rpc/index.js", () => ({
  executeArchiveRpcCall: vi.fn(),
}));

describe("createMorphoFetcher", () => {
  const MARKET_ID = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
  const USER = "0x2222222222222222222222222222222222222222" as const;
  const mockedResolveBlockByTimestamp = vi.mocked(resolveBlockByTimestamp);
  const mockedExecuteArchiveRpcCall = vi.mocked(executeArchiveRpcCall);

  const eventFetcher: EventFetcher = {
    fetchEvents: vi.fn(),
  };

  const positionRef: StateRef = {
    type: "state",
    entity_type: "Position",
    filters: [
      { field: "marketId", op: "eq", value: MARKET_ID },
      { field: "user", op: "eq", value: USER },
    ],
    field: "supplyShares",
  };

  const marketRef: StateRef = {
    type: "state",
    entity_type: "Market",
    filters: [{ field: "marketId", op: "eq", value: MARKET_ID }],
    field: "totalBorrowAssets",
  };

  const eventRef: EventRef = {
    type: "event",
    event_type: "Supply",
    filters: [{ field: "marketId", op: "eq", value: MARKET_ID }],
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

  it("routes current position state through generic archive RPC execution", async () => {
    mockedExecuteArchiveRpcCall.mockResolvedValue([123n, 0n, 0n]);
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });

    const value = await fetcher.fetchState(positionRef);

    expect(value).toBe(123);
    expect(mockedExecuteArchiveRpcCall).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        signature: expect.stringContaining("position(bytes32 id, address user)"),
      }),
    );
  });

  it("rejects position bigint values that cannot be represented safely as numbers", async () => {
    mockedExecuteArchiveRpcCall.mockResolvedValue([BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0n, 0n]);
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });

    await expect(fetcher.fetchState(positionRef)).rejects.toThrow(
      "Cannot convert position.supplyShares=",
    );
  });

  it("routes historical market state to block resolution + generic archive RPC execution", async () => {
    mockedResolveBlockByTimestamp.mockResolvedValue(19001234);
    mockedExecuteArchiveRpcCall.mockResolvedValue([0n, 0n, 456n, 0n, 0n, 0n]);
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });

    const value = await fetcher.fetchState(marketRef, 1700000000000);

    expect(value).toBe(456);
    expect(mockedResolveBlockByTimestamp).toHaveBeenCalledWith(1, 1700000000000);
    expect(mockedExecuteArchiveRpcCall).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        signature: expect.stringContaining("market(bytes32 id)"),
      }),
      19001234n,
    );
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
    mockedExecuteArchiveRpcCall.mockResolvedValue([0n, 0n, 777n, 0n, 0n, 0n]);
    const fetcher = createMorphoFetcher(eventFetcher, { chainId: 1 });
    const refWithChainOverride: StateRef = {
      ...marketRef,
      filters: [...marketRef.filters, { field: "chainId", op: "eq", value: 8453 }],
    };

    const value = await fetcher.fetchState(refWithChainOverride);

    expect(value).toBe(777);
    expect(mockedExecuteArchiveRpcCall).toHaveBeenCalledWith(
      8453,
      expect.objectContaining({
        signature: expect.stringContaining("market(bytes32 id)"),
      }),
    );
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
      filters: [{ field: "marketId", op: "eq", value: MARKET_ID }],
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
