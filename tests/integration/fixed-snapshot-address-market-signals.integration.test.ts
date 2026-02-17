import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import { readMarketAtBlock, readPositionAtBlock } from "../../src/rpc/index.js";

const RUN = process.env.RUN_LIVE_SNAPSHOT_TESTS === "true";
const suite = RUN ? describe : describe.skip;

const CHAIN_ID = 1;

// Fixed anchors captured on 2026-02-16 from live discovery.
const BLOCK_LATEST = 24_471_134n;
const BLOCK_4K = 24_467_134n;
const BLOCK_5K = 24_466_134n;
const BLOCK_10K = 24_461_132n;
const BLOCK_50K = 24_421_132n;

const ADDRESS_A = "0x2371e134e3455e0593363cbf89d3b6cf53740618";
const ADDRESS_B = "0x63c6f919ed58fd798d0c6ad8e007e24b21ac6040";

// Address A focus markets
const A_MARKET_B8 = "0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e";
const A_MARKET_37 = "0x37e7484d642d90f14451f1910ba4b7b8e4c3ccdd0ec28f8b2bdb35479e472ba7";

// Address B discovered active markets
const B_MARKET_1 = "0x3274643db77a064abd3bc851de77556a4ad2e2f502f4f0c80845fa8f909ecf0b";
const B_MARKET_2 = "0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2";
const B_MARKET_3 = "0xb7843fe78e7e7fd3106a1b939645367967d1f986c2e45edb8932ad1896450877";

// User-requested market focus
const MARKET_MAIN_1 = "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc";
const MARKET_MAIN_2 = "0x9bc98c2f20ac58287ef2c860eea53a2fdc27c17a7817ff1206c0b7840cc7cd79";

function pctChange(newValue: bigint, oldValue: bigint): number {
  if (oldValue === 0n) return newValue === 0n ? 0 : Number.POSITIVE_INFINITY;
  return (Number(newValue - oldValue) / Number(oldValue)) * 100;
}

function utilizationPercent(totalBorrowAssets: bigint, totalSupplyAssets: bigint): number {
  if (totalSupplyAssets === 0n) return 0;
  return Number((totalBorrowAssets * 10_000n) / totalSupplyAssets) / 100;
}

function allocationPercent(primary: bigint, secondary: bigint): number {
  const total = primary + secondary;
  if (total === 0n) return 0;
  return Number((primary * 10_000n) / total) / 100;
}

type PositionSnapshot = Awaited<ReturnType<typeof readPositionAtBlock>>;
type MarketSnapshot = Awaited<ReturnType<typeof readMarketAtBlock>>;

type SnapshotData = {
  aB8Latest: PositionSnapshot;
  aB810k: PositionSnapshot;
  aB850k: PositionSnapshot;
  a37Latest: PositionSnapshot;
  a3710k: PositionSnapshot;
  a3750k: PositionSnapshot;
  b1Latest: PositionSnapshot;
  b14k: PositionSnapshot;
  b15k: PositionSnapshot;
  b2Latest: PositionSnapshot;
  b24k: PositionSnapshot;
  b25k: PositionSnapshot;
  b3Latest: PositionSnapshot;
  b34k: PositionSnapshot;
  b35k: PositionSnapshot;
  m1Latest: MarketSnapshot;
  m150k: MarketSnapshot;
  m2Latest: MarketSnapshot;
  m250k: MarketSnapshot;
};

let data: SnapshotData;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
  maxAttempts = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`${label} failed after ${maxAttempts} attempts: ${String(lastError)}`);
}

suite("Fixed Mainnet Snapshot (Address + Market Signals)", () => {
  beforeAll(async () => {
    const rpc = <T>(promiseFactory: () => Promise<T>, label: string) =>
      withRetry(() => withTimeout(promiseFactory(), 20_000, label), label);

    const [
      aB8Latest,
      aB810k,
      aB850k,
      a37Latest,
      a3710k,
      a3750k,
      b1Latest,
      b14k,
      b15k,
      b2Latest,
      b24k,
      b25k,
      b3Latest,
      b34k,
      b35k,
      m1Latest,
      m150k,
      m2Latest,
      m250k,
    ] = await Promise.all([
      rpc(() => readPositionAtBlock(CHAIN_ID, A_MARKET_B8, ADDRESS_A, BLOCK_LATEST), "aB8Latest"),
      rpc(() => readPositionAtBlock(CHAIN_ID, A_MARKET_B8, ADDRESS_A, BLOCK_10K), "aB810k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, A_MARKET_B8, ADDRESS_A, BLOCK_50K), "aB850k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, A_MARKET_37, ADDRESS_A, BLOCK_LATEST), "a37Latest"),
      rpc(() => readPositionAtBlock(CHAIN_ID, A_MARKET_37, ADDRESS_A, BLOCK_10K), "a3710k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, A_MARKET_37, ADDRESS_A, BLOCK_50K), "a3750k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_1, ADDRESS_B, BLOCK_LATEST), "b1Latest"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_1, ADDRESS_B, BLOCK_4K), "b14k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_1, ADDRESS_B, BLOCK_5K), "b15k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_2, ADDRESS_B, BLOCK_LATEST), "b2Latest"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_2, ADDRESS_B, BLOCK_4K), "b24k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_2, ADDRESS_B, BLOCK_5K), "b25k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_3, ADDRESS_B, BLOCK_LATEST), "b3Latest"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_3, ADDRESS_B, BLOCK_4K), "b34k"),
      rpc(() => readPositionAtBlock(CHAIN_ID, B_MARKET_3, ADDRESS_B, BLOCK_5K), "b35k"),
      rpc(() => readMarketAtBlock(CHAIN_ID, MARKET_MAIN_1, BLOCK_LATEST), "m1Latest"),
      rpc(() => readMarketAtBlock(CHAIN_ID, MARKET_MAIN_1, BLOCK_50K), "m150k"),
      rpc(() => readMarketAtBlock(CHAIN_ID, MARKET_MAIN_2, BLOCK_LATEST), "m2Latest"),
      rpc(() => readMarketAtBlock(CHAIN_ID, MARKET_MAIN_2, BLOCK_50K), "m250k"),
    ]);

    data = {
      aB8Latest,
      aB810k,
      aB850k,
      a37Latest,
      a3710k,
      a3750k,
      b1Latest,
      b14k,
      b15k,
      b2Latest,
      b24k,
      b25k,
      b3Latest,
      b34k,
      b35k,
      m1Latest,
      m150k,
      m2Latest,
      m250k,
    };
  }, 300_000);

  it("address A: over ~50k blocks, market 37 shrank while B8 stayed nearly flat", () => {
    const b8Now = data.aB8Latest;
    const b8Old = data.aB850k;
    const m37Now = data.a37Latest;
    const m37Old = data.a3750k;

    const b8Pct = pctChange(b8Now.supplyShares, b8Old.supplyShares);
    const m37Pct = pctChange(m37Now.supplyShares, m37Old.supplyShares);
    const allocNow = allocationPercent(b8Now.supplyShares, m37Now.supplyShares);
    const allocOld = allocationPercent(b8Old.supplyShares, m37Old.supplyShares);

    expect(Math.abs(b8Pct) < 1).toBe(true);
    expect(m37Pct < -15).toBe(true);
    expect(allocNow - allocOld > 2.5).toBe(true);

    // False branch
    expect(b8Pct > 5).toBe(false);
  });

  it("address A: over ~10k blocks, market 37 grew materially while B8 was stable", () => {
    const b8Now = data.aB8Latest;
    const b8Old = data.aB810k;
    const m37Now = data.a37Latest;
    const m37Old = data.a3710k;

    const b8Pct = pctChange(b8Now.supplyShares, b8Old.supplyShares);
    const m37Pct = pctChange(m37Now.supplyShares, m37Old.supplyShares);
    const allocNow = allocationPercent(b8Now.supplyShares, m37Now.supplyShares);
    const allocOld = allocationPercent(b8Old.supplyShares, m37Old.supplyShares);

    expect(Math.abs(b8Pct) < 1).toBe(true);
    expect(m37Pct > 5).toBe(true);
    expect(allocNow < allocOld).toBe(true);

    // False branch
    expect(m37Pct > 15).toBe(false);
  });

  it("address B: stepped into three markets between 5k and 4k blocks ago", () => {
    const m1Now = data.b1Latest;
    const m1_4k = data.b14k;
    const m1_5k = data.b15k;
    const m2Now = data.b2Latest;
    const m2_4k = data.b24k;
    const m2_5k = data.b25k;
    const m3Now = data.b3Latest;
    const m3_4k = data.b34k;
    const m3_5k = data.b35k;

    const sumNow = m1Now.supplyShares + m2Now.supplyShares + m3Now.supplyShares;
    const sum4k = m1_4k.supplyShares + m2_4k.supplyShares + m3_4k.supplyShares;
    const sum5k = m1_5k.supplyShares + m2_5k.supplyShares + m3_5k.supplyShares;

    expect(sumNow > 10_000_000_000_000n).toBe(true);
    expect(sum4k).toBe(sumNow);
    expect(sum5k).toBe(0n);

    // False branch
    expect(sum5k > 0n).toBe(false);
  });

  it("address B: still unlevered across entry boundary (borrow/collateral remain zero)", () => {
    const all = [
      data.b15k,
      data.b14k,
      data.b1Latest,
      data.b25k,
      data.b24k,
      data.b2Latest,
      data.b35k,
      data.b34k,
      data.b3Latest,
    ];
    const borrowTotal = all.reduce((sum, p) => sum + p.borrowShares, 0n);
    const collateralTotal = all.reduce((sum, p) => sum + p.collateral, 0n);

    expect(borrowTotal).toBe(0n);
    expect(collateralTotal).toBe(0n);

    // False branch
    expect(borrowTotal > 0n).toBe(false);
  });

  it("market 1: strong 50k-block growth in supply/borrow and utilization", () => {
    const latest = data.m1Latest;
    const old = data.m150k;

    const supplyPct = pctChange(latest.totalSupplyAssets, old.totalSupplyAssets);
    const borrowPct = pctChange(latest.totalBorrowAssets, old.totalBorrowAssets);
    const utilNow = utilizationPercent(latest.totalBorrowAssets, latest.totalSupplyAssets);
    const utilOld = utilizationPercent(old.totalBorrowAssets, old.totalSupplyAssets);

    expect(supplyPct > 30).toBe(true);
    expect(borrowPct > 45).toBe(true);
    expect(utilNow - utilOld > 8).toBe(true);

    // False branch
    expect(utilNow > 95).toBe(false);
  });

  it("market 2: supply expansion with flat borrow and lower utilization", () => {
    const latest = data.m2Latest;
    const old = data.m250k;

    const supplyPct = pctChange(latest.totalSupplyAssets, old.totalSupplyAssets);
    const borrowPct = pctChange(latest.totalBorrowAssets, old.totalBorrowAssets);
    const utilNow = utilizationPercent(latest.totalBorrowAssets, latest.totalSupplyAssets);
    const utilOld = utilizationPercent(old.totalBorrowAssets, old.totalSupplyAssets);

    expect(supplyPct > 8).toBe(true);
    expect(borrowPct > 0 && borrowPct < 2).toBe(true);
    expect(utilOld - utilNow > 5).toBe(true);

    // False branch
    expect(borrowPct > 5).toBe(false);
  });
});
