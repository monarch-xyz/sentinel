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
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  fallback,
  isAddress,
  isHex,
  parseAbi,
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
import type { GenericRpcCall, RpcTypedArg } from "../types/index.js";
import { createLogger } from "../utils/logger.js";
import { isBytes32MarketId, normalizeMarketId } from "../utils/market.js";
import { MORPHO_ADDRESSES, type MarketResult, type PositionResult } from "./abi.js";

const logger = createLogger("rpc-client");
const RPC_TIMEOUT_MS = Number.parseInt(process.env.RPC_TIMEOUT_MS ?? "15000", 10);
const RPC_RETRY_COUNT = Number.parseInt(process.env.RPC_RETRY_COUNT ?? "1", 10);
const RPC_RETRY_DELAY_MS = Number.parseInt(process.env.RPC_RETRY_DELAY_MS ?? "250", 10);

type ResolvedRpcChain = {
  chainId: number;
  name: string;
  rpcEnvVar: string;
  rpcUrls: string[];
  archiveRequired: true;
};

type ResolvedRpcConfigurationStatus = {
  configured: boolean;
  mode: "explicit" | "test-permissive";
  supportedChains: ResolvedRpcChain[];
  issues: string[];
};

export type RpcConfiguredChainStatus = {
  chainId: number;
  name: string;
  rpcEnvVar: string;
  rpcUrlCount: number;
  archiveRequired: true;
};

export type RpcConfigurationStatus = {
  configured: boolean;
  mode: "explicit" | "test-permissive";
  supportedChains: RpcConfiguredChainStatus[];
  issues: string[];
};

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

function normalizeFunctionSignature(signature: string): string {
  const trimmed = signature.trim();
  if (!trimmed) {
    throw new Error("RPC call signature is required");
  }
  return trimmed.startsWith("function ") ? trimmed : `function ${trimmed}`;
}

function extractFunctionName(signature: string): string {
  const normalized = signature.trim().replace(/^function\s+/, "");
  const functionName = normalized.split("(")[0]?.trim();
  if (!functionName) {
    throw new Error(`Invalid function signature: ${signature}`);
  }
  return functionName;
}

function normalizeTypedArg(arg: RpcTypedArg): unknown {
  const { type, value } = arg;

  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value)) {
      throw new Error(`Invalid address argument: ${String(value)}`);
    }
    return value;
  }

  if (type === "bool") {
    if (typeof value !== "boolean") {
      throw new Error(`Invalid bool argument: ${String(value)}`);
    }
    return value;
  }

  if (type === "string") {
    if (typeof value !== "string") {
      throw new Error(`Invalid string argument: ${String(value)}`);
    }
    return value;
  }

  if (type === "bytes") {
    if (typeof value !== "string" || !isHex(value) || (value.length - 2) % 2 !== 0) {
      throw new Error(`Invalid bytes argument: ${String(value)}`);
    }
    return value;
  }

  const fixedBytesMatch = type.match(/^bytes([1-9]|[12][0-9]|3[0-2])$/);
  if (fixedBytesMatch) {
    const byteLength = Number.parseInt(fixedBytesMatch[1], 10);
    if (
      typeof value !== "string" ||
      !isHex(value) ||
      value.length !== 2 + byteLength * 2 ||
      (value.length - 2) % 2 !== 0
    ) {
      throw new Error(`Invalid ${type} argument: ${String(value)}`);
    }
    return value;
  }

  const isUint = /^uint(\d+)$/.test(type);
  const isInt = /^int(\d+)$/.test(type);
  if (isUint || isInt) {
    if (typeof value === "bigint") {
      if (isUint && value < 0n) {
        throw new Error(`Invalid ${type} argument: negative value`);
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`Invalid ${type} argument: ${String(value)}`);
      }
      if (isUint && value < 0) {
        throw new Error(`Invalid ${type} argument: negative value`);
      }
      if (!Number.isSafeInteger(value)) {
        throw new Error(
          `Invalid ${type} argument: unsafe integer number; use string or bigint for large integers`,
        );
      }
      return BigInt(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = BigInt(value);
      if (isUint && parsed < 0n) {
        throw new Error(`Invalid ${type} argument: negative value`);
      }
      return parsed;
    }
    throw new Error(`Invalid ${type} argument: ${String(value)}`);
  }

  throw new Error(`Unsupported argument type: ${type}`);
}

function toBigIntTuple(
  chainId: number,
  blockNumber: bigint | undefined,
  functionName: string,
  value: unknown,
  expectedLength: number,
): bigint[] {
  if (
    !Array.isArray(value) ||
    value.length < expectedLength ||
    value.some((entry) => typeof entry !== "bigint")
  ) {
    throw new RpcQueryError(
      `Unexpected ${functionName} response shape from archive RPC`,
      chainId,
      blockNumber,
    );
  }
  return value as bigint[];
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

let rpcConfigurationCache: ResolvedRpcConfigurationStatus | undefined;

function splitRpcUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function parseSupportedChainIds(raw: string): number[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

function buildUnsupportedChainMessage(chainId: number): string {
  const supportedChains = getConfiguredRpcChainIds();
  const supportedHint =
    supportedChains.length > 0
      ? ` Supported chains: ${supportedChains.join(", ")}.`
      : " No supported chains are configured.";
  return `Chain ${chainId} is not configured for archive RPC access.${supportedHint}`;
}

function getTestFallbackChain(chainId: number): (ResolvedRpcChain & { chain: Chain }) | undefined {
  const chain = CHAIN_MAP[chainId];
  if (!chain || !(chainId in MORPHO_ADDRESSES)) {
    return undefined;
  }

  const rpcEnvVar = `RPC_URL_${chainId}`;
  const rpcUrls = splitRpcUrls(process.env[rpcEnvVar]);
  const fallbackUrls = chain.rpcUrls.default.http.filter(Boolean);

  return {
    chainId,
    name: chain.name,
    rpcEnvVar,
    rpcUrls: rpcUrls.length > 0 ? rpcUrls : fallbackUrls,
    archiveRequired: true,
    chain,
  };
}

function getResolvedRpcConfigurationStatus(): ResolvedRpcConfigurationStatus {
  if (rpcConfigurationCache) {
    return rpcConfigurationCache;
  }

  const supportedChainsRaw = process.env.SUPPORTED_CHAIN_IDS?.trim() ?? "";
  if (!supportedChainsRaw) {
    rpcConfigurationCache =
      process.env.NODE_ENV === "test"
        ? {
            configured: true,
            mode: "test-permissive",
            supportedChains: [],
            issues: [],
          }
        : {
            configured: false,
            mode: "explicit",
            supportedChains: [],
            issues: [
              "SUPPORTED_CHAIN_IDS is required and each configured chain must also set RPC_URL_<chainId>.",
            ],
          };
    return rpcConfigurationCache;
  }

  const supportedChainIds = parseSupportedChainIds(supportedChainsRaw);
  const issues: string[] = [];
  if (supportedChainIds.length === 0) {
    issues.push("SUPPORTED_CHAIN_IDS must contain at least one positive integer chain ID.");
  }

  const supportedChains = supportedChainIds.map((chainId) => {
    const chain = CHAIN_MAP[chainId];
    const rpcEnvVar = `RPC_URL_${chainId}`;
    const rpcUrls = splitRpcUrls(process.env[rpcEnvVar]);

    if (!chain || !(chainId in MORPHO_ADDRESSES)) {
      issues.push(`Unsupported chain in SUPPORTED_CHAIN_IDS: ${chainId}.`);
      return {
        chainId,
        name: `Chain ${chainId}`,
        rpcEnvVar,
        rpcUrls,
        archiveRequired: true as const,
      };
    }

    if (rpcUrls.length === 0) {
      issues.push(`${rpcEnvVar} is required for supported chain ${chainId} (${chain.name}).`);
    }

    return {
      chainId,
      name: chain.name,
      rpcEnvVar,
      rpcUrls,
      archiveRequired: true as const,
    };
  });

  rpcConfigurationCache = {
    configured: issues.length === 0 && supportedChains.length > 0,
    mode: "explicit",
    supportedChains,
    issues,
  };
  return rpcConfigurationCache;
}

export function getRpcConfigurationStatus(): RpcConfigurationStatus {
  const status = getResolvedRpcConfigurationStatus();
  return {
    configured: status.configured,
    mode: status.mode,
    supportedChains: status.supportedChains.map((chain) => ({
      chainId: chain.chainId,
      name: chain.name,
      rpcEnvVar: chain.rpcEnvVar,
      rpcUrlCount: chain.rpcUrls.length,
      archiveRequired: chain.archiveRequired,
    })),
    issues: [...status.issues],
  };
}

export function assertRpcConfiguration(): void {
  const status = getResolvedRpcConfigurationStatus();
  if (status.mode === "test-permissive" || status.configured) {
    return;
  }

  throw new Error(status.issues.join(" "));
}

function getConfiguredRpcChain(chainId: number): ResolvedRpcChain & { chain: Chain } {
  const status = getResolvedRpcConfigurationStatus();
  if (status.mode === "test-permissive") {
    const chain = getTestFallbackChain(chainId);
    if (!chain) {
      throw new RpcQueryError(`Unsupported chain for RPC: ${chainId}`, chainId);
    }
    return chain;
  }

  const configuredChain = status.supportedChains.find((candidate) => candidate.chainId === chainId);
  if (!configuredChain) {
    throw new RpcQueryError(buildUnsupportedChainMessage(chainId), chainId);
  }

  const chain = CHAIN_MAP[chainId];
  if (!chain || !(chainId in MORPHO_ADDRESSES)) {
    throw new RpcQueryError(`Unsupported chain for RPC: ${chainId}`, chainId);
  }

  if (configuredChain.rpcUrls.length === 0) {
    throw new RpcQueryError(
      `${configuredChain.rpcEnvVar} is required for supported chain ${chainId} (${chain.name}).`,
      chainId,
    );
  }

  return {
    ...configuredChain,
    chain,
  };
}

export function getConfiguredRpcChainIds(): number[] {
  const status = getResolvedRpcConfigurationStatus();
  if (status.mode === "test-permissive") {
    return Object.keys(CHAIN_MAP)
      .map(Number)
      .filter((chainId) => chainId in MORPHO_ADDRESSES);
  }

  return status.supportedChains
    .filter((chain) => chain.rpcUrls.length > 0)
    .map((chain) => chain.chainId);
}

export function getConfiguredRpcUrls(chainId: number): string[] {
  return [...getConfiguredRpcChain(chainId).rpcUrls];
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

  const configuredChain = getConfiguredRpcChain(chainId);
  const transportOptions = {
    retryCount: RPC_RETRY_COUNT,
    retryDelay: RPC_RETRY_DELAY_MS,
    timeout: RPC_TIMEOUT_MS,
  };
  const transport =
    configuredChain.rpcUrls.length === 1
      ? http(configuredChain.rpcUrls[0], transportOptions)
      : fallback(configuredChain.rpcUrls.map((url) => http(url, transportOptions)));

  const client = createPublicClient({
    chain: configuredChain.chain,
    transport,
  });

  clientCache.set(chainId, client);
  return client;
}

function requireValidMarketId(
  chainId: number,
  marketId: string,
  blockNumber?: bigint,
): `0x${string}` {
  const normalizedMarketId = normalizeMarketId(marketId);
  if (!isBytes32MarketId(normalizedMarketId)) {
    throw new RpcQueryError(
      `Invalid market_id "${marketId}". Expected a bytes32 hex value.`,
      chainId,
      blockNumber,
    );
  }

  return normalizedMarketId as `0x${string}`;
}

export async function probeRpcChain(chainId: number): Promise<void> {
  await getPublicClient(chainId).getBlockNumber();
}

export async function executeArchiveRpcCall(
  chainId: number,
  call: GenericRpcCall,
  blockNumber?: bigint,
): Promise<unknown> {
  const client = getPublicClient(chainId);

  try {
    const functionSignature = normalizeFunctionSignature(call.signature);
    const functionName = extractFunctionName(functionSignature);

    if (!isAddress(call.to)) {
      throw new Error(`Invalid contract address: ${call.to}`);
    }

    const abi = parseAbi([functionSignature]);
    const args = call.args.map((arg) => normalizeTypedArg(arg));

    const data = encodeFunctionData({
      abi,
      functionName,
      args: args as never,
    } as never);

    const response = await client.call({
      to: call.to as `0x${string}`,
      data,
      blockNumber,
    });

    if (!response.data) {
      throw new Error("RPC call returned no data");
    }

    return decodeFunctionResult({
      abi,
      functionName,
      data: response.data,
    } as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RpcQueryError(`Failed to execute archive RPC call: ${message}`, chainId, blockNumber);
  }
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

  const normalizedMarketId = requireValidMarketId(chainId, marketId, blockNumber);

  try {
    logger.debug(
      { chainId, marketId, user, blockNumber: blockNumber.toString() },
      "Reading position at block",
    );

    const result = await executeArchiveRpcCall(
      chainId,
      {
        to: morphoAddress,
        signature:
          "position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
        args: [
          { type: "bytes32", value: normalizedMarketId },
          { type: "address", value: user },
        ],
      },
      blockNumber,
    );
    const [supplyShares, borrowShares, collateral] = toBigIntTuple(
      chainId,
      blockNumber,
      "position",
      result,
      3,
    );

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

  const normalizedMarketId = requireValidMarketId(chainId, marketId, blockNumber);

  try {
    logger.debug(
      { chainId, marketId, blockNumber: blockNumber.toString() },
      "Reading market at block",
    );

    const result = await executeArchiveRpcCall(
      chainId,
      {
        to: morphoAddress,
        signature:
          "market(bytes32 id) returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
        args: [{ type: "bytes32", value: normalizedMarketId }],
      },
      blockNumber,
    );
    const [
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    ] = toBigIntTuple(chainId, blockNumber, "market", result, 6);

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

  const normalizedMarketId = requireValidMarketId(chainId, marketId);

  try {
    const result = await executeArchiveRpcCall(chainId, {
      to: morphoAddress,
      signature:
        "position(bytes32 id, address user) returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
      args: [
        { type: "bytes32", value: normalizedMarketId },
        { type: "address", value: user },
      ],
    });
    const [supplyShares, borrowShares, collateral] = toBigIntTuple(
      chainId,
      undefined,
      "position",
      result,
      3,
    );
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

  const normalizedMarketId = requireValidMarketId(chainId, marketId);

  try {
    const result = await executeArchiveRpcCall(chainId, {
      to: morphoAddress,
      signature:
        "market(bytes32 id) returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
      args: [{ type: "bytes32", value: normalizedMarketId }],
    });
    const [
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
    ] = toBigIntTuple(chainId, undefined, "market", result, 6);

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

export function clearRpcConfigurationCache(): void {
  rpcConfigurationCache = undefined;
}

/**
 * Check if a chain is supported for RPC queries
 */
export function isChainSupportedForRpc(chainId: number): boolean {
  return getConfiguredRpcChainIds().includes(chainId);
}
