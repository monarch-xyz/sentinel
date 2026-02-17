#!/usr/bin/env npx tsx

import "dotenv/config";
import { resolveBlockByTimestamp } from "../envio/blocks.js";
import { EnvioClient } from "../envio/client.js";
import {
  getPublicClient,
  readMarketAtBlock,
  readPosition,
  readPositionAtBlock,
} from "../rpc/index.js";
import type { EventRef, Filter } from "../types/index.js";

type CandidateWindow = {
  label: string;
  durationMs: number;
  startTimeMs: number;
  blockNumber: number;
  activityCount: number;
};

type MarketValidation = {
  marketId: string;
  rpcMarketCurrent: {
    totalSupplyAssets: bigint;
    totalBorrowAssets: bigint;
    utilizationBps: number;
  };
  rpcMarketHistorical: {
    totalSupplyAssets: bigint;
    totalBorrowAssets: bigint;
    utilizationBps: number;
  };
  rpcMarketDelta: {
    totalSupplyAssets: bigint;
    totalBorrowAssets: bigint;
    utilizationBpsDelta: number;
  };
  rpcCurrent: {
    supplyShares: bigint;
    borrowShares: bigint;
    collateral: bigint;
  };
  rpcHistorical: {
    supplyShares: bigint;
    borrowShares: bigint;
    collateral: bigint;
  };
  rpcDelta: {
    supplyShares: bigint;
    borrowShares: bigint;
    collateral: bigint;
  };
  envioEvents: {
    supplyCount: number;
    withdrawCount: number;
    supplyAssets: number;
    withdrawAssets: number;
    netSupplyAssets: number;
  };
};

type MarketBaselineActivity = {
  marketId: string;
  supplyCount: number;
  withdrawCount: number;
  totalCount: number;
};

const RPC_TIMEOUT_MS = Number.parseInt(process.env.LIVE_VALIDATION_RPC_TIMEOUT_MS ?? "45000", 10);
const ENVIO_TIMEOUT_MS = Number.parseInt(
  process.env.LIVE_VALIDATION_ENVIO_TIMEOUT_MS ?? "45000",
  10,
);

const DEFAULT_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const DEFAULT_MARKETS = [
  "0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e",
  "0x5f8a138ba332398a9116910f4d5e5dcd9b207024c5290ce5bc87bc2dbd8e4a86",
  "0x37e7484d642d90f14451f1910ba4b7b8e4c3ccdd0ec28f8b2bdb35479e472ba7",
];

function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, fieldValue) => (typeof fieldValue === "bigint" ? fieldValue.toString() : fieldValue),
    2,
  );
}

async function withTimeout<T>(
  promiseFactory: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promiseFactory(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function parseArgs(): { address: string; markets: string[]; chainId: number } {
  const args = process.argv.slice(2);
  let address = DEFAULT_ADDRESS;
  let chainId = 1;
  let markets = DEFAULT_MARKETS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--address" && args[i + 1]) {
      address = args[++i];
    } else if (arg === "--markets" && args[i + 1]) {
      markets = args[++i]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--chain" && args[i + 1]) {
      chainId = Number.parseInt(args[++i], 10);
    }
  }

  return { address: address.toLowerCase(), markets, chainId };
}

function buildBaseFilters(chainId: number, marketId: string, address: string): Filter[] {
  return [
    { field: "chainId", op: "eq", value: chainId },
    { field: "marketId", op: "eq", value: marketId },
    { field: "user", op: "eq", value: address },
  ];
}

function buildMarketOnlyFilters(chainId: number, marketId: string): Filter[] {
  return [
    { field: "chainId", op: "eq", value: chainId },
    { field: "marketId", op: "eq", value: marketId },
  ];
}

function buildEventRef(
  eventType: "Supply" | "Withdraw",
  field: "id" | "assets",
  aggregation: "count" | "sum",
  filters: Filter[],
): EventRef {
  return {
    type: "event",
    event_type: eventType,
    field,
    aggregation,
    filters,
  };
}

async function getWindowActivityCount(
  envio: EnvioClient,
  chainId: number,
  address: string,
  markets: string[],
  startTimeMs: number,
  endTimeMs: number,
): Promise<number> {
  let total = 0;
  for (const marketId of markets) {
    const filters = buildBaseFilters(chainId, marketId, address);
    const supplyCountRef = buildEventRef("Supply", "id", "count", filters);
    const withdrawCountRef = buildEventRef("Withdraw", "id", "count", filters);
    const [supplyCount, withdrawCount] = await Promise.all([
      withTimeout(
        () => envio.fetchEvents(supplyCountRef, startTimeMs, endTimeMs),
        ENVIO_TIMEOUT_MS,
        `envio.fetchEvents supplyCount market=${marketId}`,
      ),
      withTimeout(
        () => envio.fetchEvents(withdrawCountRef, startTimeMs, endTimeMs),
        ENVIO_TIMEOUT_MS,
        `envio.fetchEvents withdrawCount market=${marketId}`,
      ),
    ]);
    total += supplyCount + withdrawCount;
  }
  return total;
}

async function selectTestWindow(
  envio: EnvioClient,
  chainId: number,
  address: string,
  markets: string[],
  nowMs: number,
): Promise<{ selected: CandidateWindow; candidates: CandidateWindow[] }> {
  const durations = [
    { label: "24h", durationMs: 24 * 60 * 60 * 1000 },
    { label: "7d", durationMs: 7 * 24 * 60 * 60 * 1000 },
    { label: "30d", durationMs: 30 * 24 * 60 * 60 * 1000 },
    { label: "90d", durationMs: 90 * 24 * 60 * 60 * 1000 },
    { label: "180d", durationMs: 180 * 24 * 60 * 60 * 1000 },
  ];

  const candidates: CandidateWindow[] = [];
  for (const duration of durations) {
    const startTimeMs = nowMs - duration.durationMs;
    const blockNumber = await withTimeout(
      () => resolveBlockByTimestamp(chainId, startTimeMs),
      RPC_TIMEOUT_MS,
      `resolveBlockByTimestamp chain=${chainId} start=${startTimeMs}`,
    );
    const activityCount = await getWindowActivityCount(
      envio,
      chainId,
      address,
      markets,
      startTimeMs,
      nowMs,
    );
    candidates.push({
      label: duration.label,
      durationMs: duration.durationMs,
      startTimeMs,
      blockNumber,
      activityCount,
    });
  }

  const selected =
    candidates.find((candidate) => candidate.activityCount > 0) ??
    candidates[candidates.length - 1];
  return { selected, candidates };
}

async function getMarketBaselineActivity(
  envio: EnvioClient,
  chainId: number,
  markets: string[],
  startTimeMs: number,
  endTimeMs: number,
): Promise<MarketBaselineActivity[]> {
  const baseline: MarketBaselineActivity[] = [];
  for (const marketId of markets) {
    const filters = buildMarketOnlyFilters(chainId, marketId);
    const [supplyCount, withdrawCount] = await Promise.all([
      withTimeout(
        () =>
          envio.fetchEvents(
            buildEventRef("Supply", "id", "count", filters),
            startTimeMs,
            endTimeMs,
          ),
        ENVIO_TIMEOUT_MS,
        `envio.fetchEvents baseline supplyCount market=${marketId}`,
      ),
      withTimeout(
        () =>
          envio.fetchEvents(
            buildEventRef("Withdraw", "id", "count", filters),
            startTimeMs,
            endTimeMs,
          ),
        ENVIO_TIMEOUT_MS,
        `envio.fetchEvents baseline withdrawCount market=${marketId}`,
      ),
    ]);
    baseline.push({
      marketId,
      supplyCount,
      withdrawCount,
      totalCount: supplyCount + withdrawCount,
    });
  }
  return baseline;
}

async function validateMarket(
  envio: EnvioClient,
  chainId: number,
  address: string,
  marketId: string,
  currentBlock: number,
  startTimeMs: number,
  historicalBlock: number,
  endTimeMs: number,
): Promise<MarketValidation> {
  const [marketCurrent, marketHistorical, rpcCurrent, rpcHistorical] = await Promise.all([
    withTimeout(
      () => readMarketAtBlock(chainId, marketId, BigInt(currentBlock)),
      RPC_TIMEOUT_MS,
      `readMarketAtBlock current market=${marketId} block=${currentBlock}`,
    ),
    withTimeout(
      () => readMarketAtBlock(chainId, marketId, BigInt(historicalBlock)),
      RPC_TIMEOUT_MS,
      `readMarketAtBlock historical market=${marketId} block=${historicalBlock}`,
    ),
    withTimeout(
      () => readPosition(chainId, marketId, address),
      RPC_TIMEOUT_MS,
      `readPosition current market=${marketId} address=${address}`,
    ),
    withTimeout(
      () => readPositionAtBlock(chainId, marketId, address, BigInt(historicalBlock)),
      RPC_TIMEOUT_MS,
      `readPositionAtBlock historical market=${marketId} block=${historicalBlock} address=${address}`,
    ),
  ]);
  const currentUtilizationBps =
    marketCurrent.totalSupplyAssets === 0n
      ? 0
      : Number((marketCurrent.totalBorrowAssets * 10_000n) / marketCurrent.totalSupplyAssets);
  const historicalUtilizationBps =
    marketHistorical.totalSupplyAssets === 0n
      ? 0
      : Number((marketHistorical.totalBorrowAssets * 10_000n) / marketHistorical.totalSupplyAssets);

  const filters = buildBaseFilters(chainId, marketId, address);
  const [supplyCount, withdrawCount, supplyAssets, withdrawAssets] = await Promise.all([
    withTimeout(
      () =>
        envio.fetchEvents(buildEventRef("Supply", "id", "count", filters), startTimeMs, endTimeMs),
      ENVIO_TIMEOUT_MS,
      `envio.fetchEvents supplyCount market=${marketId}`,
    ),
    withTimeout(
      () =>
        envio.fetchEvents(
          buildEventRef("Withdraw", "id", "count", filters),
          startTimeMs,
          endTimeMs,
        ),
      ENVIO_TIMEOUT_MS,
      `envio.fetchEvents withdrawCount market=${marketId}`,
    ),
    withTimeout(
      () =>
        envio.fetchEvents(
          buildEventRef("Supply", "assets", "sum", filters),
          startTimeMs,
          endTimeMs,
        ),
      ENVIO_TIMEOUT_MS,
      `envio.fetchEvents supplyAssets market=${marketId}`,
    ),
    withTimeout(
      () =>
        envio.fetchEvents(
          buildEventRef("Withdraw", "assets", "sum", filters),
          startTimeMs,
          endTimeMs,
        ),
      ENVIO_TIMEOUT_MS,
      `envio.fetchEvents withdrawAssets market=${marketId}`,
    ),
  ]);

  return {
    marketId,
    rpcMarketCurrent: {
      totalSupplyAssets: marketCurrent.totalSupplyAssets,
      totalBorrowAssets: marketCurrent.totalBorrowAssets,
      utilizationBps: currentUtilizationBps,
    },
    rpcMarketHistorical: {
      totalSupplyAssets: marketHistorical.totalSupplyAssets,
      totalBorrowAssets: marketHistorical.totalBorrowAssets,
      utilizationBps: historicalUtilizationBps,
    },
    rpcMarketDelta: {
      totalSupplyAssets: marketCurrent.totalSupplyAssets - marketHistorical.totalSupplyAssets,
      totalBorrowAssets: marketCurrent.totalBorrowAssets - marketHistorical.totalBorrowAssets,
      utilizationBpsDelta: currentUtilizationBps - historicalUtilizationBps,
    },
    rpcCurrent,
    rpcHistorical,
    rpcDelta: {
      supplyShares: rpcCurrent.supplyShares - rpcHistorical.supplyShares,
      borrowShares: rpcCurrent.borrowShares - rpcHistorical.borrowShares,
      collateral: rpcCurrent.collateral - rpcHistorical.collateral,
    },
    envioEvents: {
      supplyCount,
      withdrawCount,
      supplyAssets,
      withdrawAssets,
      netSupplyAssets: supplyAssets - withdrawAssets,
    },
  };
}

async function main() {
  const { address, markets, chainId } = parseArgs();
  const envio = new EnvioClient();
  const rpcClient = getPublicClient(chainId);
  const nowMs = Date.now();

  console.log("=== Sentinel Live Envio+RPC Validation ===");
  console.log(`Chain ID: ${chainId}`);
  console.log(`Address: ${address}`);
  console.log(`Markets: ${markets.length}`);
  console.log(`RPC timeout ms: ${RPC_TIMEOUT_MS}`);
  console.log(`Envio timeout ms: ${ENVIO_TIMEOUT_MS}`);

  const latestBlockNumber = Number(
    await withTimeout(
      () => rpcClient.getBlockNumber(),
      RPC_TIMEOUT_MS,
      `rpcClient.getBlockNumber chain=${chainId}`,
    ),
  );
  const latestBlock = await withTimeout(
    () => rpcClient.getBlock({ blockNumber: BigInt(latestBlockNumber) }),
    RPC_TIMEOUT_MS,
    `rpcClient.getBlock chain=${chainId} block=${latestBlockNumber}`,
  );
  console.log("\nStep 1: Latest block from RPC");
  console.log(
    stringifyJson({
      blockNumber: latestBlockNumber,
      blockTimestampSec: Number(latestBlock.timestamp),
      blockTimestampIso: new Date(Number(latestBlock.timestamp) * 1000).toISOString(),
    }),
  );

  const { selected, candidates } = await selectTestWindow(envio, chainId, address, markets, nowMs);
  console.log("\nStep 2: Candidate historical windows and activity");
  console.log(
    stringifyJson(
      candidates.map((candidate) => ({
        window: candidate.label,
        startTimeIso: new Date(candidate.startTimeMs).toISOString(),
        startBlock: candidate.blockNumber,
        activityCount: candidate.activityCount,
      })),
    ),
  );
  console.log("\nSelected historical test block");
  console.log(
    stringifyJson({
      window: selected.label,
      startTimeIso: new Date(selected.startTimeMs).toISOString(),
      startBlock: selected.blockNumber,
      reason:
        selected.activityCount > 0
          ? "first window with non-zero Supply/Withdraw activity"
          : `fallback to longest window (${selected.label}) due zero detected activity`,
    }),
  );

  const results: MarketValidation[] = [];
  const failures: Array<{ marketId: string; error: string }> = [];
  for (const marketId of markets) {
    try {
      const result = await validateMarket(
        envio,
        chainId,
        address,
        marketId,
        latestBlockNumber,
        selected.startTimeMs,
        selected.blockNumber,
        nowMs,
      );
      results.push(result);
    } catch (error) {
      failures.push({
        marketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("\nPer-market validation (Envio events + RPC state deltas)");
  console.log(stringifyJson(results));

  if (failures.length > 0) {
    console.log("\nMarkets with errors");
    console.log(stringifyJson(failures));
  }

  const successCount = results.length;
  const totalCount = markets.length;
  console.log("\nValidation summary");
  console.log(
    stringifyJson({
      marketsRequested: totalCount,
      marketsValidated: successCount,
      marketsFailed: failures.length,
      checks: {
        rpcCurrentAndHistorical: successCount > 0,
        envioEventQueries: successCount > 0,
        mixedPathValidated: successCount > 0,
      },
    }),
  );

  const totalScopedEvents = results.reduce(
    (sum, result) => sum + result.envioEvents.supplyCount + result.envioEvents.withdrawCount,
    0,
  );
  if (totalScopedEvents === 0) {
    const baseline = await getMarketBaselineActivity(
      envio,
      chainId,
      markets,
      selected.startTimeMs,
      nowMs,
    );
    console.log("\nMarket-only Envio baseline (same markets/window, no address filter)");
    console.log(stringifyJson(baseline));
  }

  if (successCount === 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Live validation failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
