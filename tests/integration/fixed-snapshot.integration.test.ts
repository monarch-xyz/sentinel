import "dotenv/config";
import { describe, expect, it } from "vitest";
import { EnvioClient } from "../../src/envio/client.js";
import { readMarketAtBlock } from "../../src/rpc/index.js";
import type { EventRef, Filter } from "../../src/types/index.js";

const RUN = process.env.RUN_LIVE_SNAPSHOT_TESTS === "true";
const suite = RUN ? describe : describe.skip;

const CHAIN_ID = 1;
const TEST_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

// Fixed anchors captured on 2026-02-16 (do not change unless you intentionally refresh fixtures).
const NEWER_BLOCK = 24_471_004n;
const OLDER_BLOCK = 23_183_913n;
const WINDOW_START_MS = Date.parse("2025-08-20T17:54:18.601Z");
const WINDOW_END_MS = Date.parse("2026-02-16T17:54:18.601Z");

const MARKET_A = "0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e";
const MARKET_C = "0x37e7484d642d90f14451f1910ba4b7b8e4c3ccdd0ec28f8b2bdb35479e472ba7";

function utilizationBps(totalBorrowAssets: bigint, totalSupplyAssets: bigint): number {
  if (totalSupplyAssets === 0n) return 0;
  return Number((totalBorrowAssets * 10_000n) / totalSupplyAssets);
}

function percentChange(newValue: bigint, oldValue: bigint): number {
  if (oldValue === 0n) return newValue === 0n ? 0 : Number.POSITIVE_INFINITY;
  return (Number(newValue - oldValue) / Number(oldValue)) * 100;
}

function eventRef(
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

suite("Fixed Mainnet Snapshot (Envio + RPC)", () => {
  it("market A: supply growth + borrow growth + high utilization should be TRUE", async () => {
    const [newer, older] = await Promise.all([
      readMarketAtBlock(CHAIN_ID, MARKET_A, NEWER_BLOCK),
      readMarketAtBlock(CHAIN_ID, MARKET_A, OLDER_BLOCK),
    ]);

    const supplyGrowthPct = percentChange(newer.totalSupplyAssets, older.totalSupplyAssets);
    const borrowGrowthAbs = newer.totalBorrowAssets - older.totalBorrowAssets;
    const utilNow = utilizationBps(newer.totalBorrowAssets, newer.totalSupplyAssets);

    const composite =
      supplyGrowthPct > 80 && // percent condition
      borrowGrowthAbs > 30_000_000_000_000_000_000_000n && // absolute condition
      utilNow > 9000; // threshold condition (90%)

    expect(composite).toBe(true);
  }, 60_000);

  it("market C: supply drop true, large util jump false", async () => {
    const [newer, older] = await Promise.all([
      readMarketAtBlock(CHAIN_ID, MARKET_C, NEWER_BLOCK),
      readMarketAtBlock(CHAIN_ID, MARKET_C, OLDER_BLOCK),
    ]);

    const supplyGrowthPct = percentChange(newer.totalSupplyAssets, older.totalSupplyAssets);
    const utilDelta =
      utilizationBps(newer.totalBorrowAssets, newer.totalSupplyAssets) -
      utilizationBps(older.totalBorrowAssets, older.totalSupplyAssets);

    expect(supplyGrowthPct < -5).toBe(true); // TRUE branch
    expect(utilDelta > 100).toBe(false); // FALSE branch
  }, 60_000);

  it("mixed Envio+RPC: market is active while target address has no Supply events", async () => {
    const envio = new EnvioClient();

    const marketFilters: Filter[] = [
      { field: "chainId", op: "eq", value: CHAIN_ID },
      { field: "marketId", op: "eq", value: MARKET_A },
    ];
    const userFilters: Filter[] = [
      ...marketFilters,
      { field: "user", op: "eq", value: TEST_ADDRESS },
    ];

    const [marketSupplyCount, userSupplyCount] = await Promise.all([
      envio.fetchEvents(
        eventRef("Supply", "id", "count", marketFilters),
        WINDOW_START_MS,
        WINDOW_END_MS,
      ),
      envio.fetchEvents(
        eventRef("Supply", "id", "count", userFilters),
        WINDOW_START_MS,
        WINDOW_END_MS,
      ),
    ]);

    const newer = await readMarketAtBlock(CHAIN_ID, MARKET_A, NEWER_BLOCK);
    const older = await readMarketAtBlock(CHAIN_ID, MARKET_A, OLDER_BLOCK);
    const rpcGrowthTrue = percentChange(newer.totalSupplyAssets, older.totalSupplyAssets) > 80;

    expect(marketSupplyCount > 0).toBe(true);
    expect(userSupplyCount === 0).toBe(true);
    expect(userSupplyCount > 0).toBe(false);
    expect(rpcGrowthTrue).toBe(true);
  }, 90_000);
});
