/**
 * RPC Client for point-in-time state queries
 *
 * Uses viem to read Morpho contract state at specific block numbers.
 * This is a complementary data source to the indexer (Envio), not a fallback.
 */

import {
  http,
  type Chain,
  type PublicClient,
  createPublicClient,
  defineChain,
  fallback,
} from "viem";
import { arbitrum, base, mainnet, polygon } from "viem/chains";

/**
 * Custom chain definitions for chains not in viem's default set
 */
const unichain = defineChain({
  id: 130,
  name: "Unichain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.unichain.org"] },
  },
  blockExplorers: {
    default: { name: "Uniscan", url: "https://uniscan.xyz" },
  },
});

const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.hyperliquid.xyz/evm"] },
  },
  blockExplorers: {
    default: { name: "HyperEVM Explorer", url: "https://explorer.hyperliquid.xyz" },
  },
});

const monad = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
});
import { createLogger } from "../utils/logger.js";
import { MORPHO_ADDRESSES, type MarketResult, type PositionResult, morphoAbi } from "./abi.js";

const logger = createLogger("rpc-client");
const RPC_TIMEOUT_MS = Number.parseInt(process.env.RPC_TIMEOUT_MS ?? "15000", 10);
const RPC_RETRY_COUNT = Number.parseInt(process.env.RPC_RETRY_COUNT ?? "1", 10);
const RPC_RETRY_DELAY_MS = Number.parseInt(process.env.RPC_RETRY_DELAY_MS ?? "250", 10);

/**
 * Error thrown when RPC queries fail
 */
export class RpcQueryError extends Error {
  constructor(
    message: string,
    public readonly chainId: number,
    public readonly blockNumber?: bigint,
  ) {
    super(message);
    this.name = "RpcQueryError";
  }
}

/**
 * Chain configurations for viem
 */
const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  137: polygon,
  130: unichain,
  42161: arbitrum,
  999: hyperEvm,
  10143: monad,
};

/**
 * Get RPC URL for a chain, checking env vars first
 * Env var format: RPC_URL_{chainId} (e.g., RPC_URL_1 for Ethereum)
 */
function getRpcUrls(chainId: number): string[] {
  const envVar = process.env[`RPC_URL_${chainId}`];
  if (!envVar) return [];
  return envVar
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * Client cache to avoid recreating clients
 */
const clientCache = new Map<number, PublicClient>();

/**
 * Get or create a public client for a chain
 */
export function getPublicClient(chainId: number): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) return cached;

  const chain = CHAIN_MAP[chainId];
  if (!chain) {
    throw new RpcQueryError(`Unsupported chain for RPC: ${chainId}`, chainId);
  }

  const rpcUrls = getRpcUrls(chainId);
  const transportOptions = {
    retryCount: RPC_RETRY_COUNT,
    retryDelay: RPC_RETRY_DELAY_MS,
    timeout: RPC_TIMEOUT_MS,
  };
  const transport =
    rpcUrls.length === 0
      ? http(undefined, transportOptions)
      : rpcUrls.length === 1
        ? http(rpcUrls[0], transportOptions)
        : fallback(rpcUrls.map((url) => http(url, transportOptions)));

  const client = createPublicClient({
    chain,
    transport,
  });

  clientCache.set(chainId, client);
  return client;
}

/**
 * Read position state at a specific block
 *
 * @param chainId - Chain ID
 * @param marketId - Morpho market ID (bytes32 hex string)
 * @param user - User address
 * @param blockNumber - Block number to query at
 * @returns Position data (supplyShares, borrowShares, collateral)
 */
export async function readPositionAtBlock(
  chainId: number,
  marketId: string,
  user: string,
  blockNumber: bigint,
): Promise<PositionResult> {
  const morphoAddress = MORPHO_ADDRESSES[chainId];
  if (!morphoAddress) {
    throw new RpcQueryError(`Morpho not deployed on chain ${chainId}`, chainId, blockNumber);
  }

  const client = getPublicClient(chainId);

  try {
    logger.debug(
      { chainId, marketId, user, blockNumber: blockNumber.toString() },
      "Reading position at block",
    );

    const result = await client.readContract({
      address: morphoAddress,
      abi: morphoAbi,
      functionName: "position",
      args: [marketId as `0x${string}`, user as `0x${string}`],
      blockNumber,
    });

    // Result is a tuple [supplyShares, borrowShares, collateral]
    const [supplyShares, borrowShares, collateral] = result as [bigint, bigint, bigint];

    return {
      supplyShares,
      borrowShares,
      collateral,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { chainId, marketId, user, blockNumber: blockNumber.toString(), error: message },
      "Failed to read position",
    );
    throw new RpcQueryError(`Failed to read position: ${message}`, chainId, blockNumber);
  }
}

/**
 * Read market state at a specific block
 *
 * @param chainId - Chain ID
 * @param marketId - Morpho market ID (bytes32 hex string)
 * @param blockNumber - Block number to query at
 * @returns Market data
 */
export async function readMarketAtBlock(
  chainId: number,
  marketId: string,
  blockNumber: bigint,
): Promise<MarketResult> {
  const morphoAddress = MORPHO_ADDRESSES[chainId];
  if (!morphoAddress) {
    throw new RpcQueryError(`Morpho not deployed on chain ${chainId}`, chainId, blockNumber);
  }

  const client = getPublicClient(chainId);

  try {
    logger.debug(
      { chainId, marketId, blockNumber: blockNumber.toString() },
      "Reading market at block",
    );

    const result = await client.readContract({
      address: morphoAddress,
      abi: morphoAbi,
      functionName: "market",
      args: [marketId as `0x${string}`],
      blockNumber,
    });

    // Result is a tuple
    const [
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    ] = result as [bigint, bigint, bigint, bigint, bigint, bigint];

    return {
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { chainId, marketId, blockNumber: blockNumber.toString(), error: message },
      "Failed to read market",
    );
    throw new RpcQueryError(`Failed to read market: ${message}`, chainId, blockNumber);
  }
}

/**
 * Read current position state (latest block)
 */
export async function readPosition(
  chainId: number,
  marketId: string,
  user: string,
): Promise<PositionResult> {
  const morphoAddress = MORPHO_ADDRESSES[chainId];
  if (!morphoAddress) {
    throw new RpcQueryError(`Morpho not deployed on chain ${chainId}`, chainId);
  }

  const client = getPublicClient(chainId);

  try {
    const result = await client.readContract({
      address: morphoAddress,
      abi: morphoAbi,
      functionName: "position",
      args: [marketId as `0x${string}`, user as `0x${string}`],
    });

    const [supplyShares, borrowShares, collateral] = result as [bigint, bigint, bigint];
    return { supplyShares, borrowShares, collateral };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RpcQueryError(`Failed to read position: ${message}`, chainId);
  }
}

/**
 * Read current market state (latest block)
 */
export async function readMarket(chainId: number, marketId: string): Promise<MarketResult> {
  const morphoAddress = MORPHO_ADDRESSES[chainId];
  if (!morphoAddress) {
    throw new RpcQueryError(`Morpho not deployed on chain ${chainId}`, chainId);
  }

  const client = getPublicClient(chainId);

  try {
    const result = await client.readContract({
      address: morphoAddress,
      abi: morphoAbi,
      functionName: "market",
      args: [marketId as `0x${string}`],
    });

    const [
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    ] = result as [bigint, bigint, bigint, bigint, bigint, bigint];

    return {
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RpcQueryError(`Failed to read market: ${message}`, chainId);
  }
}

/**
 * Clear client cache (useful for testing)
 */
export function clearClientCache(): void {
  clientCache.clear();
}

/**
 * Check if a chain is supported for RPC queries
 */
export function isChainSupportedForRpc(chainId: number): boolean {
  return chainId in MORPHO_ADDRESSES && chainId in CHAIN_MAP;
}
