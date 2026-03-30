import { HypersyncClient, JoinMode, type Log, type Query } from "@envio-dev/hypersync-client";
import { type AbiEvent, decodeEventLog, encodeAbiParameters, parseAbiItem } from "viem";
import { config } from "../config/index.ts";
import { resolveBlockByTimestamp } from "../envio/blocks.ts";
import type { Filter, RawEventQuery, RawEventRef } from "../types/index.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("hypersync-client");

const clientCache = new Map<number, HypersyncClient>();
const abiCache = new Map<string, AbiEvent>();

type NumericValue = number | bigint;

type AggregationState = {
  count: number;
  sum: NumericValue | null;
  min: NumericValue | null;
  max: NumericValue | null;
};

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

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

export async function probeHyperSync(chainId: number): Promise<void> {
  const client = getClient(chainId);
  await client.getHeight();
}

function getParsedAbiItem(signature: string) {
  const cached = abiCache.get(signature);
  if (cached) return cached;
  const abiItem = parseAbiItem(signature);
  if (abiItem.type !== "event") {
    throw new Error(`raw-events signature must be an event: ${signature}`);
  }
  abiCache.set(signature, abiItem);
  return abiItem;
}

function supportsTopicPushdown(type: string): boolean {
  if (type.includes("[") || type === "string" || type === "bytes" || type.startsWith("tuple")) {
    return false;
  }

  return (
    type === "address" ||
    type === "bool" ||
    /^uint(\d{0,3})$/.test(type) ||
    /^int(\d{0,3})$/.test(type) ||
    /^bytes([1-9]|[1-2]\d|3[0-2])$/.test(type)
  );
}

function coerceTopicValue(type: string, value: string | number | boolean): unknown {
  if (type === "address" || /^bytes([1-9]|[1-2]\d|3[0-2])$/.test(type)) {
    if (typeof value !== "string") {
      throw new Error(`raw-events topic filter for ${type} requires a string value`);
    }
    return value.toLowerCase();
  }

  if (type === "bool") {
    if (typeof value !== "boolean") {
      throw new Error("raw-events topic filter for bool requires a boolean value");
    }
    return value;
  }

  if (/^u?int(\d{0,3})$/.test(type)) {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        throw new Error(`raw-events topic filter for ${type} requires a safe integer value`);
      }
      return BigInt(value);
    }

    if (typeof value === "string" && /^-?\d+$/.test(value)) {
      return BigInt(value);
    }

    throw new Error(`raw-events topic filter for ${type} requires an integer value`);
  }

  return value;
}

function encodeTopicValue(type: string, value: string | number | boolean): string {
  return encodeAbiParameters([{ type }], [coerceTopicValue(type, value)]).toLowerCase();
}

function trimTrailingWildcards(topics: string[][]): string[][] {
  const trimmed = [...topics];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]?.length === 0) {
    trimmed.pop();
  }
  return trimmed;
}

function buildTopicFilters(
  abiItem: AbiEvent,
  query: RawEventQuery,
  filters?: Filter[],
): string[][] {
  const topics: string[][] = [[query.topic0]];
  if (!filters || filters.length === 0) {
    return topics;
  }

  let indexedInputPosition = 0;
  for (const input of abiItem.inputs ?? []) {
    if (!input.indexed) {
      continue;
    }

    indexedInputPosition += 1;

    const matchingFilter = filters.find(
      (filter) => filter.field === input.name && (filter.op === "eq" || filter.op === "in"),
    );
    if (!matchingFilter || !supportsTopicPushdown(input.type)) {
      continue;
    }

    const values = Array.isArray(matchingFilter.value)
      ? matchingFilter.value
      : [matchingFilter.value];
    const encodedValues = values
      .filter(
        (value): value is string | number | boolean =>
          typeof value === "string" || typeof value === "number" || typeof value === "boolean",
      )
      .map((value) => encodeTopicValue(input.type, value));

    if (encodedValues.length === 0) {
      continue;
    }

    while (topics.length <= indexedInputPosition) {
      topics.push([]);
    }
    topics[indexedInputPosition] = encodedValues;
  }

  return trimTrailingWildcards(topics);
}

function buildAddressFilters(ref: RawEventRef): string[] | undefined {
  const contractAddressFilters = ref.filters
    ?.filter(
      (filter) => filter.field === "contract_address" && (filter.op === "eq" || filter.op === "in"),
    )
    .flatMap((filter) => (Array.isArray(filter.value) ? filter.value : [filter.value]))
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  const merged = [
    ...(ref.contractAddresses?.map((address) => address.toLowerCase()) ?? []),
    ...(contractAddressFilters ?? []),
  ];

  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

function normalizeStringValue(value: string): string {
  return value.startsWith("0x") ? value.toLowerCase() : value;
}

function normalizeComparableValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeStringValue(value);
  if (Array.isArray(value)) return value.map((item) => normalizeComparableValue(item));
  return value;
}

function toNumericValue(value: unknown): NumericValue | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && value.length > 0) {
    if (/^-?\d+$/.test(value)) {
      return BigInt(value);
    }
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

function bigintToSafeNumber(value: bigint): number | undefined {
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) {
    return undefined;
  }
  return Number(value);
}

function toComparableBigInt(value: NumericValue): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}

function toComparableNumber(value: NumericValue): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return bigintToSafeNumber(value);
}

function alignNumericValues(
  left: NumericValue,
  right: NumericValue,
): [number, number] | [bigint, bigint] | undefined {
  const leftBigInt = toComparableBigInt(left);
  const rightBigInt = toComparableBigInt(right);
  if (leftBigInt !== undefined && rightBigInt !== undefined) {
    return [leftBigInt, rightBigInt];
  }

  const leftNumber = toComparableNumber(left);
  const rightNumber = toComparableNumber(right);
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return [leftNumber, rightNumber];
  }

  return undefined;
}

function compareNumericValues(
  left: NumericValue,
  right: NumericValue,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
): boolean | undefined {
  const aligned = alignNumericValues(left, right);
  if (!aligned) return undefined;

  const [leftValue, rightValue] = aligned;
  switch (op) {
    case "eq":
      return leftValue === rightValue;
    case "neq":
      return leftValue !== rightValue;
    case "gt":
      return leftValue > rightValue;
    case "gte":
      return leftValue >= rightValue;
    case "lt":
      return leftValue < rightValue;
    case "lte":
      return leftValue <= rightValue;
    default:
      return undefined;
  }
}

function compareComparableValues(left: unknown, right: unknown): boolean {
  const leftNumeric = toNumericValue(left);
  const rightNumeric = toNumericValue(right);
  if (leftNumeric !== undefined && rightNumeric !== undefined) {
    const numericResult = compareNumericValues(leftNumeric, rightNumeric, "eq");
    if (numericResult !== undefined) {
      return numericResult;
    }
  }

  return left === right;
}

function compareFilter(actual: unknown, filter: Filter): boolean {
  if (actual === undefined || actual === null) return false;

  const normalizedActual = normalizeComparableValue(actual);
  const normalizedFilterValue = normalizeComparableValue(filter.value);

  switch (filter.op) {
    case "eq":
      return compareComparableValues(normalizedActual, normalizedFilterValue);
    case "neq":
      return !compareComparableValues(normalizedActual, normalizedFilterValue);
    case "in":
      return (
        Array.isArray(normalizedFilterValue) &&
        normalizedFilterValue.some((candidate) =>
          compareComparableValues(normalizedActual, candidate),
        )
      );
    case "contains":
      if (typeof normalizedActual === "string") {
        return normalizedActual.includes(String(normalizedFilterValue));
      }
      if (Array.isArray(normalizedActual)) {
        return normalizedActual.some((candidate) =>
          compareComparableValues(candidate, normalizedFilterValue),
        );
      }
      return false;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const actualNumber = toNumericValue(normalizedActual);
      const filterNumber = toNumericValue(normalizedFilterValue);
      if (actualNumber === undefined || filterNumber === undefined) return false;

      return compareNumericValues(actualNumber, filterNumber, filter.op) ?? false;
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
  value: NumericValue | undefined,
): void {
  state.count += 1;

  if (aggregation === "count") {
    return;
  }

  if (value === undefined) {
    throw new Error("raw-events aggregation field could not be converted to a numeric value");
  }

  if (state.sum === null) {
    state.sum = value;
  } else {
    const aligned = alignNumericValues(state.sum, value);
    if (!aligned) {
      throw new Error("raw-events aggregation encountered incompatible numeric types");
    }
    if (typeof aligned[0] === "bigint") {
      const [left, right] = aligned as [bigint, bigint];
      state.sum = left + right;
    } else {
      const [left, right] = aligned as [number, number];
      state.sum = left + right;
    }
  }

  if (state.min === null) {
    state.min = value;
  } else {
    const aligned = alignNumericValues(state.min, value);
    if (!aligned) {
      throw new Error("raw-events aggregation encountered incompatible numeric types");
    }
    state.min = aligned[0] <= aligned[1] ? aligned[0] : aligned[1];
  }

  if (state.max === null) {
    state.max = value;
  } else {
    const aligned = alignNumericValues(state.max, value);
    if (!aligned) {
      throw new Error("raw-events aggregation encountered incompatible numeric types");
    }
    state.max = aligned[0] >= aligned[1] ? aligned[0] : aligned[1];
  }
}

function numericValueToNumber(value: NumericValue): number {
  if (typeof value === "number") return value;

  const safeNumber = bigintToSafeNumber(value);
  if (safeNumber === undefined) {
    throw new Error("raw-events aggregation result exceeds safe numeric range");
  }
  return safeNumber;
}

function finalizeAggregation(
  state: AggregationState,
  aggregation: RawEventRef["aggregation"],
): number {
  switch (aggregation) {
    case "count":
      return state.count;
    case "sum":
      return state.sum === null ? 0 : numericValueToNumber(state.sum);
    case "avg":
      return state.count === 0 || state.sum === null
        ? 0
        : numericValueToNumber(state.sum) / state.count;
    case "min":
      return state.min === null ? 0 : numericValueToNumber(state.min);
    case "max":
      return state.max === null ? 0 : numericValueToNumber(state.max);
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
      const state: AggregationState = { count: 0, sum: null, min: null, max: null };
      const queries = getQueryList(ref);

      for (const query of queries) {
        const abiItem = getParsedAbiItem(query.eventSignature);
        const topicFilters = buildTopicFilters(abiItem, query, ref.filters);
        const addressFilters = buildAddressFilters(ref);
        const queryBase: Omit<Query, "fromBlock"> = {
          toBlock,
          logs: [
            {
              address: addressFilters,
              topics: topicFilters,
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
        let logsSeenForQuery = 0;

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
            logsSeenForQuery += 1;
            if (logsSeenForQuery > config.hypersync.maxLogsPerQuery) {
              throw new HyperSyncQueryError(
                `raw-events query exceeded max logs (${config.hypersync.maxLogsPerQuery}). Narrow the query with contract_addresses or a shorter window, or raise HYPERSYNC_MAX_LOGS_PER_QUERY.`,
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
