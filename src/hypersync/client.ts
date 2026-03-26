import { HypersyncClient, JoinMode, type Log, type Query } from "@envio-dev/hypersync-client";
import { decodeEventLog, parseAbiItem } from "viem";
import { config } from "../config/index.js";
import { resolveBlockByTimestamp } from "../envio/blocks.js";
import type { Filter, RawEventQuery, RawEventRef } from "../types/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("hypersync-client");

const clientCache = new Map<number, HypersyncClient>();
const abiCache = new Map<string, ReturnType<typeof parseAbiItem>>();

type AggregationState = {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
};

export class HyperSyncQueryError extends Error {
  constructor(
    message: string,
    public readonly chainId: number,
  ) {
    super(message);
    this.name = "HyperSyncQueryError";
  }
}

function getHyperSyncUrl(chainId: number): string {
  const chainSpecificUrl = process.env[`HYPERSYNC_URL_${chainId}`]?.trim();
  if (chainSpecificUrl) return chainSpecificUrl;
  return `https://${chainId}.hypersync.xyz`;
}

function getClient(chainId: number): HypersyncClient {
  const cached = clientCache.get(chainId);
  if (cached) return cached;

  if (!config.hypersync.apiToken) {
    throw new HyperSyncQueryError(
      "ENVIO_API_TOKEN is required for raw-events HyperSync queries",
      chainId,
    );
  }

  const client = new HypersyncClient({
    url: getHyperSyncUrl(chainId),
    apiToken: config.hypersync.apiToken,
  });

  clientCache.set(chainId, client);
  return client;
}

function getParsedAbiItem(signature: string) {
  const cached = abiCache.get(signature);
  if (cached) return cached;
  const abiItem = parseAbiItem(signature);
  abiCache.set(signature, abiItem);
  return abiItem;
}

function normalizeStringValue(value: string): string {
  return value.startsWith("0x") ? value.toLowerCase() : value;
}

function normalizeComparableValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeStringValue(value);
  if (Array.isArray(value)) return value.map((item) => normalizeComparableValue(item));
  return value;
}

function toNumericValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function compareFilter(actual: unknown, filter: Filter): boolean {
  if (actual === undefined || actual === null) return false;

  const normalizedActual = normalizeComparableValue(actual);
  const normalizedFilterValue = normalizeComparableValue(filter.value);

  switch (filter.op) {
    case "eq":
      return normalizedActual === normalizedFilterValue;
    case "neq":
      return normalizedActual !== normalizedFilterValue;
    case "in":
      return (
        Array.isArray(normalizedFilterValue) &&
        normalizedFilterValue.includes(normalizedActual as string | number)
      );
    case "contains":
      if (typeof normalizedActual === "string") {
        return normalizedActual.includes(String(normalizedFilterValue));
      }
      if (Array.isArray(normalizedActual)) {
        return normalizedActual.includes(normalizedFilterValue);
      }
      return false;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const actualNumber = toNumericValue(normalizedActual);
      const filterNumber = toNumericValue(normalizedFilterValue);
      if (actualNumber === undefined || filterNumber === undefined) return false;

      switch (filter.op) {
        case "gt":
          return actualNumber > filterNumber;
        case "gte":
          return actualNumber >= filterNumber;
        case "lt":
          return actualNumber < filterNumber;
        case "lte":
          return actualNumber <= filterNumber;
        default:
          return false;
      }
    }
    default:
      return false;
  }
}

function matchesFilters(record: Record<string, unknown>, filters?: Filter[]): boolean {
  if (!filters || filters.length === 0) return true;
  return filters.every((filter) => compareFilter(record[filter.field], filter));
}

function buildDecodedRecord(
  log: Log,
  decodedArgs: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...decodedArgs,
    contract_address: log.address,
    block_number: log.blockNumber,
    transaction_hash: log.transactionHash,
    log_index: log.logIndex,
  };
}

function toBigIntValue(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function buildNormalizedFields(
  query: RawEventQuery,
  decodedArgs: Record<string, unknown>,
): Record<string, unknown> {
  switch (query.normalizer) {
    case "uniswap_v2_swap": {
      const amount0In = toBigIntValue(decodedArgs.amount0In) ?? 0n;
      const amount1In = toBigIntValue(decodedArgs.amount1In) ?? 0n;
      const amount0Out = toBigIntValue(decodedArgs.amount0Out) ?? 0n;
      const amount1Out = toBigIntValue(decodedArgs.amount1Out) ?? 0n;
      return {
        recipient: decodedArgs.to,
        amount0_in: amount0In,
        amount1_in: amount1In,
        amount0_out: amount0Out,
        amount1_out: amount1Out,
        amount0_abs: amount0In + amount0Out,
        amount1_abs: amount1In + amount1Out,
        swap_protocol: "uniswap_v2",
      };
    }
    case "uniswap_v3_swap": {
      const amount0 = toBigIntValue(decodedArgs.amount0) ?? 0n;
      const amount1 = toBigIntValue(decodedArgs.amount1) ?? 0n;
      return {
        amount0_in: amount0 > 0n ? amount0 : 0n,
        amount1_in: amount1 > 0n ? amount1 : 0n,
        amount0_out: amount0 < 0n ? absBigInt(amount0) : 0n,
        amount1_out: amount1 < 0n ? absBigInt(amount1) : 0n,
        amount0_abs: absBigInt(amount0),
        amount1_abs: absBigInt(amount1),
        swap_protocol: "uniswap_v3",
      };
    }
    default:
      return {};
  }
}

function normalizeTopics(
  topics: Array<string | undefined | null>,
): [`0x${string}`, ...`0x${string}`[]] {
  const normalized = topics.filter((topic): topic is `0x${string}` => typeof topic === "string");
  if (normalized.length === 0) {
    throw new Error("raw-events log is missing topic0");
  }
  return normalized as [`0x${string}`, ...`0x${string}`[]];
}

function updateAggregation(
  state: AggregationState,
  aggregation: RawEventRef["aggregation"],
  value: number | undefined,
): void {
  state.count += 1;

  if (aggregation === "count") {
    return;
  }

  if (value === undefined) {
    throw new Error("raw-events aggregation field could not be converted to a number");
  }

  state.sum += value;
  state.min = state.min === null ? value : Math.min(state.min, value);
  state.max = state.max === null ? value : Math.max(state.max, value);
}

function finalizeAggregation(
  state: AggregationState,
  aggregation: RawEventRef["aggregation"],
): number {
  switch (aggregation) {
    case "count":
      return state.count;
    case "sum":
      return state.sum;
    case "avg":
      return state.count === 0 ? 0 : state.sum / state.count;
    case "min":
      return state.min ?? 0;
    case "max":
      return state.max ?? 0;
    default:
      return 0;
  }
}

function getQueryList(ref: RawEventRef): RawEventQuery[] {
  if (ref.queries.length === 0) {
    throw new Error("raw-events query list must not be empty");
  }
  return ref.queries;
}

export class HyperSyncClient {
  async fetchRawEvents(ref: RawEventRef, startTimeMs: number, endTimeMs: number): Promise<number> {
    const client = getClient(ref.chainId);

    try {
      const [startBlock, endBlock] = await Promise.all([
        resolveBlockByTimestamp(ref.chainId, startTimeMs),
        resolveBlockByTimestamp(ref.chainId, endTimeMs),
      ]);

      const toBlock = Math.max(startBlock + 1, endBlock + 1);
      const state: AggregationState = { count: 0, sum: 0, min: null, max: null };
      let totalLogsSeen = 0;
      const queries = getQueryList(ref);

      for (const query of queries) {
        const abiItem = getParsedAbiItem(query.eventSignature);
        const queryBase: Omit<Query, "fromBlock"> = {
          toBlock,
          logs: [
            {
              address: ref.contractAddresses,
              topics: [[query.topic0]],
            },
          ],
          fieldSelection: {
            block: ["Number", "Timestamp"],
            log: [
              "BlockNumber",
              "LogIndex",
              "TransactionHash",
              "Address",
              "Data",
              "Topic0",
              "Topic1",
              "Topic2",
              "Topic3",
            ],
          },
          joinMode: JoinMode.Default,
          maxNumLogs: config.hypersync.maxLogsPerRequest,
        };

        let nextBlock = startBlock;
        let pageCount = 0;

        while (nextBlock < toBlock) {
          pageCount += 1;
          if (pageCount > config.hypersync.maxPagesPerQuery) {
            throw new HyperSyncQueryError(
              `raw-events query exceeded max pages (${config.hypersync.maxPagesPerQuery})`,
              ref.chainId,
            );
          }

          const response = await client.get({
            fromBlock: nextBlock,
            ...queryBase,
          });

          if (response.nextBlock <= nextBlock) {
            throw new HyperSyncQueryError("HyperSync pagination did not advance", ref.chainId);
          }

          const blockTimestamps = new Map<number, number>();
          for (const block of response.data.blocks) {
            if (typeof block.number === "number" && typeof block.timestamp === "number") {
              blockTimestamps.set(block.number, block.timestamp);
            }
          }

          for (const log of response.data.logs) {
            totalLogsSeen += 1;
            if (totalLogsSeen > config.hypersync.maxLogsPerQuery) {
              throw new HyperSyncQueryError(
                `raw-events query exceeded max logs (${config.hypersync.maxLogsPerQuery})`,
                ref.chainId,
              );
            }

            if (typeof log.blockNumber !== "number") continue;
            const blockTimestampSec = blockTimestamps.get(log.blockNumber);
            if (blockTimestampSec === undefined) continue;

            const blockTimestampMs = blockTimestampSec * 1000;
            if (blockTimestampMs < startTimeMs || blockTimestampMs > endTimeMs) continue;

            const decoded = decodeEventLog({
              abi: [abiItem],
              data: (log.data ?? "0x") as `0x${string}`,
              topics: normalizeTopics(log.topics),
            });

            const decodedArgs =
              decoded.args && !Array.isArray(decoded.args)
                ? (decoded.args as Record<string, unknown>)
                : {};

            const normalizedFields = buildNormalizedFields(query, decodedArgs);
            const record = buildDecodedRecord(log, { ...decodedArgs, ...normalizedFields });
            if (!matchesFilters(record, ref.filters)) continue;

            const value = ref.field ? toNumericValue(record[ref.field]) : undefined;
            updateAggregation(state, ref.aggregation, value);
          }

          if (response.nextBlock >= toBlock) {
            break;
          }

          nextBlock = response.nextBlock;
        }
      }

      return finalizeAggregation(state, ref.aggregation);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.error(
        {
          chainId: ref.chainId,
          signatures: ref.queries.map((query) => query.eventSignature),
          startTimeMs,
          endTimeMs,
          error: message,
        },
        "HyperSync raw-events query failed",
      );
      if (error instanceof HyperSyncQueryError) throw error;
      throw new HyperSyncQueryError(`HyperSync raw-events query failed: ${message}`, ref.chainId);
    }
  }
}

export function clearHyperSyncClientCache(): void {
  clientCache.clear();
  abiCache.clear();
}
