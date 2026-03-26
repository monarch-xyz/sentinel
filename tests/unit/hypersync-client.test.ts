import { encodeAbiParameters, toEventSelector } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config/index.js";
import { resolveBlockByTimestamp } from "../../src/envio/blocks.js";
import { HyperSyncClient, clearHyperSyncClientCache } from "../../src/hypersync/client.js";
import type { RawEventRef } from "../../src/types/index.js";

const getMock = vi.fn();

vi.mock("@envio-dev/hypersync-client", () => ({
  HypersyncClient: vi.fn().mockImplementation(() => ({
    get: getMock,
  })),
  JoinMode: {
    Default: 0,
  },
}));

vi.mock("../../src/envio/blocks.js", () => ({
  resolveBlockByTimestamp: vi.fn(),
}));

describe("HyperSyncClient", () => {
  const mockedResolveBlockByTimestamp = vi.mocked(resolveBlockByTimestamp);
  const mutableHypersyncConfig = config.hypersync as unknown as {
    apiToken: string;
    maxLogsPerRequest: number;
    maxLogsPerQuery: number;
    maxPagesPerQuery: number;
  };
  const originalHypersyncConfig = {
    apiToken: mutableHypersyncConfig.apiToken,
    maxLogsPerRequest: mutableHypersyncConfig.maxLogsPerRequest,
    maxLogsPerQuery: mutableHypersyncConfig.maxLogsPerQuery,
    maxPagesPerQuery: mutableHypersyncConfig.maxPagesPerQuery,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearHyperSyncClientCache();
    mutableHypersyncConfig.apiToken = "test-token";
    mutableHypersyncConfig.maxLogsPerRequest = 1000;
    mutableHypersyncConfig.maxLogsPerQuery = 10000;
    mutableHypersyncConfig.maxPagesPerQuery = 10;
  });

  afterEach(() => {
    clearHyperSyncClientCache();
    mutableHypersyncConfig.apiToken = originalHypersyncConfig.apiToken;
    mutableHypersyncConfig.maxLogsPerRequest = originalHypersyncConfig.maxLogsPerRequest;
    mutableHypersyncConfig.maxLogsPerQuery = originalHypersyncConfig.maxLogsPerQuery;
    mutableHypersyncConfig.maxPagesPerQuery = originalHypersyncConfig.maxPagesPerQuery;
  });

  it("aggregates decoded ERC20 transfer values with decoded-argument filters", async () => {
    mockedResolveBlockByTimestamp.mockResolvedValueOnce(100).mockResolvedValueOnce(101);

    getMock.mockResolvedValue({
      nextBlock: 102,
      totalExecutionTime: 1,
      data: {
        blocks: [
          { number: 100, timestamp: 1_700_000_000 },
          { number: 101, timestamp: 1_700_000_001 },
        ],
        transactions: [],
        traces: [],
        logs: [
          {
            blockNumber: 100,
            logIndex: 0,
            transactionHash: "0xaaaa",
            address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            data: "0x0000000000000000000000000000000000000000000000000000000000000032",
            topics: [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000001111111111111111111111111111111111111111",
              "0x0000000000000000000000002222222222222222222222222222222222222222",
            ],
          },
          {
            blockNumber: 101,
            logIndex: 1,
            transactionHash: "0xbbbb",
            address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            data: "0x0000000000000000000000000000000000000000000000000000000000000005",
            topics: [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000003333333333333333333333333333333333333333",
              "0x0000000000000000000000002222222222222222222222222222222222222222",
            ],
          },
        ],
      },
    });

    const client = new HyperSyncClient();
    const ref: RawEventRef = {
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
      contractAddresses: ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
      field: "value",
      aggregation: "sum",
      filters: [{ field: "from", op: "eq", value: "0x1111111111111111111111111111111111111111" }],
    };

    const result = await client.fetchRawEvents(ref, 1_700_000_000_000, 1_700_000_001_999);

    expect(result).toBe(50);
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 100,
        toBlock: 102,
        maxNumLogs: 1000,
      }),
    );
  });

  it("matches bigint decoded fields against string and array filters", async () => {
    mockedResolveBlockByTimestamp.mockResolvedValueOnce(100).mockResolvedValueOnce(100);

    getMock.mockResolvedValue({
      nextBlock: 101,
      totalExecutionTime: 1,
      data: {
        blocks: [{ number: 100, timestamp: 1_700_000_000 }],
        transactions: [],
        traces: [],
        logs: [
          {
            blockNumber: 100,
            logIndex: 0,
            transactionHash: "0xcccc",
            address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            data: "0x0000000000000000000000000000000000000000000000000000000000000032",
            topics: [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000001111111111111111111111111111111111111111",
              "0x0000000000000000000000002222222222222222222222222222222222222222",
            ],
          },
        ],
      },
    });

    const client = new HyperSyncClient();
    const ref: RawEventRef = {
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
      contractAddresses: ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
      field: "value",
      aggregation: "sum",
      filters: [
        { field: "value", op: "eq", value: "50" },
        { field: "value", op: "in", value: [40, 50] },
        { field: "value", op: "gte", value: 50 },
      ],
    };

    const result = await client.fetchRawEvents(ref, 1_700_000_000_000, 1_700_000_000_999);

    expect(result).toBe(50);
  });

  it("aggregates normalized swap fields across uniswap v2 and v3 presets", async () => {
    mockedResolveBlockByTimestamp.mockResolvedValueOnce(100).mockResolvedValueOnce(101);
    mutableHypersyncConfig.maxLogsPerQuery = 1;

    getMock
      .mockResolvedValueOnce({
        nextBlock: 102,
        totalExecutionTime: 1,
        data: {
          blocks: [
            { number: 100, timestamp: 1_700_000_000 },
            { number: 101, timestamp: 1_700_000_001 },
          ],
          transactions: [],
          traces: [],
          logs: [
            {
              blockNumber: 100,
              logIndex: 0,
              transactionHash: "0xswapv2",
              address: "0x1111111111111111111111111111111111111111",
              data: encodeAbiParameters(
                [
                  { type: "uint256" },
                  { type: "uint256" },
                  { type: "uint256" },
                  { type: "uint256" },
                ],
                [30n, 0n, 0n, 5n],
              ),
              topics: [
                toEventSelector(
                  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
                ),
                "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        nextBlock: 102,
        totalExecutionTime: 1,
        data: {
          blocks: [
            { number: 100, timestamp: 1_700_000_000 },
            { number: 101, timestamp: 1_700_000_001 },
          ],
          transactions: [],
          traces: [],
          logs: [
            {
              blockNumber: 101,
              logIndex: 1,
              transactionHash: "0xswapv3",
              address: "0x2222222222222222222222222222222222222222",
              data: encodeAbiParameters(
                [
                  { type: "int256" },
                  { type: "int256" },
                  { type: "uint160" },
                  { type: "uint128" },
                  { type: "int24" },
                ],
                [-20n, 40n, 0n, 0n, 0],
              ),
              topics: [
                toEventSelector(
                  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
                ),
                "0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc",
                "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              ],
            },
          ],
        },
      });

    const client = new HyperSyncClient();
    const ref: RawEventRef = {
      type: "raw_event",
      source: "hypersync",
      chainId: 1,
      queries: [
        {
          eventSignature:
            "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
          topic0: toEventSelector(
            "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
          ),
          normalizer: "uniswap_v2_swap",
        },
        {
          eventSignature:
            "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
          topic0: toEventSelector(
            "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
          ),
          normalizer: "uniswap_v3_swap",
        },
      ],
      field: "amount0_abs",
      aggregation: "sum",
      filters: [
        { field: "recipient", op: "eq", value: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      ],
    };

    const result = await client.fetchRawEvents(ref, 1_700_000_000_000, 1_700_000_001_999);

    expect(result).toBe(50);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
