import axios from "axios";

/**
 * Chain configuration for block resolution
 */
interface ChainConfig {
  name: string;
  rpcEndpoints: string[];
  genesisTimestamp: number; // Unix timestamp in seconds
  avgBlockTimeMs: number;
}

/**
 * Get RPC endpoints for a chain, checking env vars first
 * Env var format: RPC_URL_{chainId} (e.g., RPC_URL_1 for Ethereum)
 * Multiple URLs can be comma-separated
 */
function getRpcEndpoints(chainId: number, fallbackEndpoints: string[]): string[] {
  const envVar = process.env[`RPC_URL_${chainId}`];
  if (envVar) {
    // Split by comma and trim whitespace
    const customEndpoints = envVar
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    if (customEndpoints.length > 0) {
      // Custom endpoints take priority, fallbacks as backup
      return [...customEndpoints, ...fallbackEndpoints];
    }
  }
  return fallbackEndpoints;
}

/**
 * Known chain configurations
 * Supported chains: Ethereum, Base, Polygon, Arbitrum, Monad, Unichain, Hyperliquid
 */
const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // === Production Chains ===
  1: {
    name: "Ethereum",
    rpcEndpoints: [
      "https://eth.llamarpc.com",
      "https://rpc.ankr.com/eth",
      "https://ethereum.publicnode.com",
    ],
    genesisTimestamp: 1438269973, // July 30, 2015
    avgBlockTimeMs: 12000,
  },
  8453: {
    name: "Base",
    rpcEndpoints: [
      "https://mainnet.base.org",
      "https://base.llamarpc.com",
      "https://base.publicnode.com",
    ],
    genesisTimestamp: 1686789347, // June 15, 2023
    avgBlockTimeMs: 2000,
  },
  137: {
    name: "Polygon",
    rpcEndpoints: ["https://polygon-rpc.com", "https://rpc.ankr.com/polygon"],
    genesisTimestamp: 1590824836, // May 30, 2020
    avgBlockTimeMs: 2000,
  },
  42161: {
    name: "Arbitrum",
    rpcEndpoints: ["https://arb1.arbitrum.io/rpc", "https://rpc.ankr.com/arbitrum"],
    genesisTimestamp: 1622243344, // May 28, 2021
    avgBlockTimeMs: 250,
  },

  // === Newer Chains (update RPC/genesis as needed) ===
  // Monad - High-performance EVM L1
  10143: {
    name: "Monad",
    rpcEndpoints: [
      "https://rpc.monad.xyz", // Update with actual RPC
    ],
    genesisTimestamp: 1704067200, // Placeholder - Jan 1, 2024
    avgBlockTimeMs: 500, // Monad targets ~500ms blocks
  },
  // Unichain - Uniswap L2 (OP Stack)
  130: {
    name: "Unichain",
    rpcEndpoints: [
      "https://rpc.unichain.org", // Update with actual RPC
    ],
    genesisTimestamp: 1704067200, // Placeholder - update when mainnet
    avgBlockTimeMs: 2000,
  },
  // Hyperliquid - Native chain
  999: {
    name: "Hyperliquid",
    rpcEndpoints: [
      "https://rpc.hyperliquid.xyz", // Update with actual RPC
    ],
    genesisTimestamp: 1704067200, // Placeholder
    avgBlockTimeMs: 1000,
  },
};

/**
 * Simple LRU Cache implementation
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest entry (first in map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Cache for block lookups: key is `${chainId}:${timestampSeconds}`
const blockCache = new LRUCache<string, number>(1000);

/**
 * Make an RPC call with fallback to alternate endpoints
 */
async function rpcCall(chainId: number, method: string, params: unknown[]): Promise<unknown> {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  // Get endpoints with env var override support
  const endpoints = getRpcEndpoints(chainId, config.rpcEndpoints);
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await axios.post(
        endpoint,
        {
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        },
        {
          timeout: 10000,
          headers: { "Content-Type": "application/json" },
        },
      );

      if (response.data.error) {
        throw new Error(response.data.error.message || "RPC error");
      }

      return response.data.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next endpoint
    }
  }

  throw lastError || new Error("All RPC endpoints failed");
}

/**
 * Get block by number
 */
async function getBlock(
  chainId: number,
  blockNumber: number | "latest",
): Promise<{ number: number; timestamp: number }> {
  const blockParam = blockNumber === "latest" ? "latest" : `0x${blockNumber.toString(16)}`;

  const result = (await rpcCall(chainId, "eth_getBlockByNumber", [blockParam, false])) as {
    number: string;
    timestamp: string;
  } | null;

  if (!result) {
    throw new Error(`Block not found: ${blockNumber}`);
  }

  return {
    number: Number.parseInt(result.number, 16),
    timestamp: Number.parseInt(result.timestamp, 16),
  };
}

/**
 * Estimate block number from timestamp by working BACKWARDS from latest block.
 * This is more accurate because block times can change over a chain's lifetime
 * (e.g., Ethereum pre/post-merge went from ~13s to ~12s).
 *
 * @param latestBlock - The current latest block (number + timestamp)
 * @param targetTimestampSec - The target timestamp to find
 * @param avgBlockTimeMs - Average block time in milliseconds
 */
function estimateBlockFromLatest(
  latestBlock: { number: number; timestamp: number },
  targetTimestampSec: number,
  avgBlockTimeMs: number,
): number {
  // Calculate time difference from latest block (moving to earlier blocks)
  const timeDiffSec = latestBlock.timestamp - targetTimestampSec;

  if (timeDiffSec <= 0) {
    // Target is at or after latest block
    return latestBlock.number;
  }

  // Estimate how many blocks back we need to go
  const blocksBack = Math.floor((timeDiffSec * 1000) / avgBlockTimeMs);
  const estimatedBlock = latestBlock.number - blocksBack;

  // Don't go below 0
  return Math.max(0, estimatedBlock);
}

/**
 * @deprecated Use estimateBlockFromLatest instead - kept for fallback
 */
function estimateBlockNumber(chainId: number, timestampSec: number): number {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    // Fallback for unknown chains: assume 12s blocks from Unix epoch
    return Math.floor((timestampSec * 1000) / 12000);
  }

  const elapsedSec = timestampSec - config.genesisTimestamp;
  if (elapsedSec <= 0) return 0;

  return Math.floor((elapsedSec * 1000) / config.avgBlockTimeMs);
}

/**
 * Binary search to find the first block with timestamp >= target.
 *
 * NOTE: For fast chains with blocktime < 1s (e.g., Arbitrum at 0.25s),
 * multiple blocks may share the same timestamp. This function returns
 * ONE of those blocks, not necessarily the first or last.
 */
async function binarySearchBlock(
  chainId: number,
  targetTimestampSec: number,
  latestBlock: { number: number; timestamp: number },
): Promise<number> {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  // Edge case: target is at or before genesis
  if (targetTimestampSec <= config.genesisTimestamp) {
    return 0;
  }

  // Edge case: target is at or after latest block
  if (targetTimestampSec >= latestBlock.timestamp) {
    return latestBlock.number;
  }

  // Start with an estimate working BACKWARDS from latest block
  // This is more accurate as block times can change over chain lifetime
  let low = 0;
  let high = latestBlock.number;
  const estimate = estimateBlockFromLatest(latestBlock, targetTimestampSec, config.avgBlockTimeMs);

  // Use estimate as starting point for binary search bounds
  const block = await getBlock(chainId, estimate);

  if (block.timestamp >= targetTimestampSec) {
    high = block.number;
  } else {
    low = block.number;
  }

  // Binary search to find first block with timestamp >= target
  const maxIterations = 50;
  for (let i = 0; i < maxIterations; i++) {
    if (high - low <= 1) {
      // Check low first - if it satisfies, return it
      const lowBlock = await getBlock(chainId, low);
      if (lowBlock.timestamp >= targetTimestampSec) {
        return low;
      }
      return high;
    }

    const mid = Math.floor((low + high) / 2);
    const midBlock = await getBlock(chainId, mid);

    if (midBlock.timestamp >= targetTimestampSec) {
      high = mid;
    } else {
      low = mid;
    }
  }

  // If we exhausted iterations, return high (first block >= target)
  return high;
}

/**
 * Resolve a timestamp to a block number for a given chain
 *
 * @param chainId - The chain ID (1 for Ethereum, 8453 for Base, etc.)
 * @param timestampMs - The target timestamp in milliseconds
 * @returns The block number closest to but not exceeding the timestamp
 * @throws Error if the chain is not supported or RPC calls fail
 */
export async function resolveBlockByTimestamp(
  chainId: number,
  timestampMs: number,
): Promise<number> {
  const timestampSec = Math.floor(timestampMs / 1000);
  const cacheKey = `${chainId}:${timestampSec}`;

  // Check cache first
  const cached = blockCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    // For unsupported chains, use estimation as fallback
    const estimated = estimateBlockNumber(chainId, timestampSec);
    blockCache.set(cacheKey, estimated);
    return estimated;
  }

  // Handle edge case: timestamp before genesis
  if (timestampSec <= config.genesisTimestamp) {
    blockCache.set(cacheKey, 0);
    return 0;
  }

  try {
    // Get latest block to establish upper bound
    const latestBlock = await getBlock(chainId, "latest");

    // Handle edge case: timestamp in the future
    if (timestampSec >= latestBlock.timestamp) {
      blockCache.set(cacheKey, latestBlock.number);
      return latestBlock.number;
    }

    // Perform binary search
    const blockNumber = await binarySearchBlock(chainId, timestampSec, latestBlock);

    // Cache the result
    blockCache.set(cacheKey, blockNumber);
    return blockNumber;
  } catch (error) {
    // Fallback to estimation if RPC fails
    const estimated = estimateBlockNumber(chainId, timestampSec);
    blockCache.set(cacheKey, estimated);
    return estimated;
  }
}

/**
 * Get supported chain IDs
 */
export function getSupportedChains(): number[] {
  return Object.keys(CHAIN_CONFIGS).map(Number);
}

/**
 * Check if a chain is supported
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in CHAIN_CONFIGS;
}

/**
 * Clear the block cache (useful for testing)
 */
export function clearBlockCache(): void {
  blockCache.clear();
}

/**
 * Get cache stats (useful for monitoring)
 */
export function getBlockCacheSize(): number {
  return blockCache.size();
}

/**
 * Add or update chain configuration (useful for adding new chains at runtime)
 */
export function addChainConfig(chainId: number, config: ChainConfig): void {
  CHAIN_CONFIGS[chainId] = config;
}

// Export for testing
export { CHAIN_CONFIGS, LRUCache, blockCache };
