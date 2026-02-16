import { http, type PublicClient, createPublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RpcQueryError,
  clearClientCache,
  getPublicClient,
  isChainSupportedForRpc,
  readMarketAtBlock,
  readPositionAtBlock,
} from "../../src/rpc/client.js";

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(),
    http: vi.fn(),
  };
});

describe("rpc client", () => {
  const createPublicClientMock = vi.mocked(createPublicClient);
  const httpMock = vi.mocked(http);
  const originalRpcUrl1 = process.env.RPC_URL_1;

  function createClientWithReadContract(readContract: PublicClient["readContract"]): PublicClient {
    return { readContract } as unknown as PublicClient;
  }

  beforeEach(() => {
    clearClientCache();
    vi.clearAllMocks();
    httpMock.mockImplementation((url?: string) => ({ url }) as unknown as ReturnType<typeof http>);
  });

  afterEach(() => {
    if (originalRpcUrl1 === undefined) {
      // biome-ignore lint/performance/noDelete: env cleanup for test isolation
      delete process.env.RPC_URL_1;
    } else {
      process.env.RPC_URL_1 = originalRpcUrl1;
    }
  });

  it("caches public clients per chain and honors RPC_URL_{chainId}", () => {
    process.env.RPC_URL_1 = "https://rpc.example.org,https://fallback.example.org";
    const client = createClientWithReadContract(vi.fn());
    createPublicClientMock.mockReturnValue(client);

    const first = getPublicClient(1);
    const second = getPublicClient(1);

    expect(first).toBe(second);
    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith("https://rpc.example.org");
  });

  it("throws RpcQueryError for unsupported chains", () => {
    expect(() => getPublicClient(10)).toThrow(RpcQueryError);
    expect(() => getPublicClient(10)).toThrow("Unsupported chain for RPC: 10");
  });

  it("reads position at block via contract call", async () => {
    const readContract = vi.fn().mockResolvedValue([11n, 22n, 33n]);
    createPublicClientMock.mockReturnValue(createClientWithReadContract(readContract));

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
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "position",
        blockNumber: 19000000n,
      }),
    );
  });

  it("reads market at block via contract call", async () => {
    const readContract = vi.fn().mockResolvedValue([100n, 200n, 300n, 400n, 500n, 600n]);
    createPublicClientMock.mockReturnValue(createClientWithReadContract(readContract));

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
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "market",
        blockNumber: 19000001n,
      }),
    );
  });

  it("wraps readContract failures in RpcQueryError", async () => {
    const readContract = vi.fn().mockRejectedValue(new Error("execution reverted"));
    createPublicClientMock.mockReturnValue(createClientWithReadContract(readContract));

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
});
