import {
  http,
  type PublicClient,
  createPublicClient,
  encodeFunctionData,
  encodeFunctionResult,
  fallback,
  parseAbi,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RpcQueryError,
  clearClientCache,
  clearRpcConfigurationCache,
  executeArchiveRpcCall,
  getPublicClient,
  getRpcConfigurationStatus,
  isChainSupportedForRpc,
  readMarketAtBlock,
  readPositionAtBlock,
} from "../../src/rpc/client.ts";

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(),
    fallback: vi.fn((transports: unknown[]) => transports[0]),
    http: vi.fn(),
  };
});

describe("rpc client", () => {
  const createPublicClientMock = vi.mocked(createPublicClient);
  const fallbackMock = vi.mocked(fallback);
  const httpMock = vi.mocked(http);
  const originalSupportedChainIds = process.env.SUPPORTED_CHAIN_IDS;
  const originalRpcUrl1 = process.env.RPC_URL_1;
  const originalRpcUrl10 = process.env.RPC_URL_10;

  function createClientWithCall(call: PublicClient["call"]): PublicClient {
    return { call } as unknown as PublicClient;
  }

  beforeEach(() => {
    clearClientCache();
    clearRpcConfigurationCache();
    vi.clearAllMocks();
    httpMock.mockImplementation((url?: string) => ({ url }) as unknown as ReturnType<typeof http>);
    fallbackMock.mockImplementation((transports) => transports[0]);
    process.env.SUPPORTED_CHAIN_IDS = "1";
    process.env.RPC_URL_1 = "https://rpc.example.org";
  });

  afterEach(() => {
    clearRpcConfigurationCache();
    if (originalRpcUrl1 === undefined) {
      // biome-ignore lint/performance/noDelete: env cleanup for test isolation
      delete process.env.RPC_URL_1;
    } else {
      process.env.RPC_URL_1 = originalRpcUrl1;
    }
    if (originalRpcUrl10 === undefined) {
      // biome-ignore lint/performance/noDelete: env cleanup for test isolation
      delete process.env.RPC_URL_10;
    } else {
      process.env.RPC_URL_10 = originalRpcUrl10;
    }
    if (originalSupportedChainIds === undefined) {
      // biome-ignore lint/performance/noDelete: env cleanup for test isolation
      delete process.env.SUPPORTED_CHAIN_IDS;
    } else {
      process.env.SUPPORTED_CHAIN_IDS = originalSupportedChainIds;
    }
  });

  it("caches public clients per chain and honors RPC_URL_{chainId}", () => {
    process.env.RPC_URL_1 = "https://rpc.example.org,https://fallback.example.org";
    const client = createClientWithCall(vi.fn());
    createPublicClientMock.mockReturnValue(client);

    const first = getPublicClient(1);
    const second = getPublicClient(1);

    expect(first).toBe(second);
    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledTimes(2);
    expect(httpMock).toHaveBeenNthCalledWith(
      1,
      "https://rpc.example.org",
      expect.objectContaining({
        retryCount: 1,
        retryDelay: 250,
        timeout: 15000,
      }),
    );
    expect(httpMock).toHaveBeenNthCalledWith(
      2,
      "https://fallback.example.org",
      expect.objectContaining({
        retryCount: 1,
        retryDelay: 250,
        timeout: 15000,
      }),
    );
    expect(fallbackMock).toHaveBeenCalledTimes(1);
  });

  it("throws RpcQueryError for unsupported chains", () => {
    expect(() => getPublicClient(10)).toThrow(RpcQueryError);
    expect(() => getPublicClient(10)).toThrow("Chain 10 is not configured for archive RPC access");
  });

  it("supports generic configured chains outside MORPHO_ADDRESSES", () => {
    process.env.SUPPORTED_CHAIN_IDS = "10";
    process.env.RPC_URL_10 = "https://rpc.optimism.example.org";
    clearRpcConfigurationCache();

    const client = createClientWithCall(vi.fn());
    createPublicClientMock.mockReturnValue(client);

    const resolved = getPublicClient(10);

    expect(resolved).toBe(client);
    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith(
      "https://rpc.optimism.example.org",
      expect.objectContaining({
        retryCount: 1,
        retryDelay: 250,
        timeout: 15000,
      }),
    );
  });

  it("executes generic archive RPC calls and decodes tuple outputs", async () => {
    const abi = parseAbi([
      "function position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
    ]);
    const callMock = vi.fn().mockResolvedValue({
      data: encodeFunctionResult({
        abi,
        functionName: "position",
        result: [11n, 22n, 33n],
      }),
    });
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    const result = await executeArchiveRpcCall(
      1,
      {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature:
          "position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
        args: [
          {
            type: "bytes32",
            value: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
          { type: "address", value: "0x2222222222222222222222222222222222222222" },
        ],
      },
      19000000n,
    );

    expect(result).toEqual([11n, 22n, 33n]);
    expect(callMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        blockNumber: 19000000n,
        data: encodeFunctionData({
          abi,
          functionName: "position",
          args: [
            "0x1111111111111111111111111111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
          ],
        }),
      }),
    );
  });

  it("supports bytes and fixed-bytes typed arguments", async () => {
    const abi = parseAbi(["function inspect(bytes payload, bytes32 salt) returns (bytes32)"]);
    const callMock = vi.fn().mockResolvedValue({
      data: encodeFunctionResult({
        abi,
        functionName: "inspect",
        result: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    });
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    const result = await executeArchiveRpcCall(1, {
      to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
      signature: "inspect(bytes payload, bytes32 salt) returns (bytes32)",
      args: [
        { type: "bytes", value: "0x1234" },
        {
          type: "bytes32",
          value: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    });

    expect(result).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("rejects malformed fixed-bytes args", async () => {
    const callMock = vi.fn();
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    await expect(
      executeArchiveRpcCall(1, {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature: "inspect(bytes32 salt) returns (bytes32)",
        args: [{ type: "bytes32", value: "0x1234" }],
      }),
    ).rejects.toThrow(RpcQueryError);
    await expect(
      executeArchiveRpcCall(1, {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature: "inspect(bytes32 salt) returns (bytes32)",
        args: [{ type: "bytes32", value: "0x1234" }],
      }),
    ).rejects.toThrow("Failed to execute archive RPC call: Invalid bytes32 argument");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe integer number args for int/uint types", async () => {
    const callMock = vi.fn();
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    await expect(
      executeArchiveRpcCall(1, {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature: "setValue(uint256 value) returns (uint256)",
        args: [{ type: "uint256", value: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    ).rejects.toThrow(
      "Failed to execute archive RPC call: Invalid uint256 argument: unsafe integer number; use string or bigint for large integers",
    );
    expect(callMock).not.toHaveBeenCalled();
  });

  it("wraps invalid function signatures as RpcQueryError", async () => {
    const callMock = vi.fn();
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    await expect(
      executeArchiveRpcCall(1, {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature: "not a real signature",
        args: [],
      }),
    ).rejects.toThrow(RpcQueryError);
    await expect(
      executeArchiveRpcCall(1, {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature: "not a real signature",
        args: [],
      }),
    ).rejects.toThrow("Failed to execute archive RPC call:");
    expect(callMock).not.toHaveBeenCalled();
  });

  it("wraps missing returned data as RpcQueryError", async () => {
    const callMock = vi.fn().mockResolvedValue({});
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    await expect(
      executeArchiveRpcCall(1, {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature: "totalSupply() returns (uint256)",
        args: [],
      }),
    ).rejects.toThrow(RpcQueryError);
    await expect(
      executeArchiveRpcCall(1, {
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        signature: "totalSupply() returns (uint256)",
        args: [],
      }),
    ).rejects.toThrow("Failed to execute archive RPC call: RPC call returned no data");
  });

  it("reads position at block via the generic executor", async () => {
    const abi = parseAbi([
      "function position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
    ]);
    const callMock = vi.fn().mockResolvedValue({
      data: encodeFunctionResult({
        abi,
        functionName: "position",
        result: [11n, 22n, 33n],
      }),
    });
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    const result = await readPositionAtBlock(
      1,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      19000000n,
    );

    expect(result).toEqual({
      supplyShares: 11n,
      borrowShares: 22n,
      collateral: 33n,
    });
    expect(callMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        blockNumber: 19000000n,
      }),
    );
  });

  it("reads market at block via the generic executor", async () => {
    const abi = parseAbi([
      "function market(bytes32 id) returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
    ]);
    const callMock = vi.fn().mockResolvedValue({
      data: encodeFunctionResult({
        abi,
        functionName: "market",
        result: [100n, 200n, 300n, 400n, 500n, 600n],
      }),
    });
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    const result = await readMarketAtBlock(
      1,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      19000001n,
    );

    expect(result).toEqual({
      totalSupplyAssets: 100n,
      totalSupplyShares: 200n,
      totalBorrowAssets: 300n,
      totalBorrowShares: 400n,
      lastUpdate: 500n,
      fee: 600n,
    });
    expect(callMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        blockNumber: 19000001n,
      }),
    );
  });

  it("wraps generic execution failures in RpcQueryError", async () => {
    const callMock = vi.fn().mockRejectedValue(new Error("execution reverted"));
    createPublicClientMock.mockReturnValue(createClientWithCall(callMock));

    await expect(
      readPositionAtBlock(
        1,
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "0x3333333333333333333333333333333333333333",
        19000002n,
      ),
    ).rejects.toThrow(RpcQueryError);
  });

  it("reports chain support accurately", () => {
    expect(isChainSupportedForRpc(1)).toBe(true);
    expect(isChainSupportedForRpc(10)).toBe(false);
  });

  it("reports missing archive RPC configuration at startup", () => {
    // biome-ignore lint/performance/noDelete: env cleanup for test isolation
    delete process.env.RPC_URL_1;
    clearRpcConfigurationCache();

    expect(getRpcConfigurationStatus()).toMatchObject({
      configured: false,
      issues: [expect.stringContaining("RPC_URL_1 is required")],
    });
  });
});
