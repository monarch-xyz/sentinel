import "dotenv/config";
import { toEventSelector } from "viem";
import { describe, expect, it } from "vitest";
import { HyperSyncClient } from "../../src/hypersync/client.js";
import type { RawEventRef } from "../../src/types/index.js";

const RUN = process.env.RUN_LIVE_HYPERSYNC_TESTS === "true";
const suite = RUN ? describe : describe.skip;

const ETHEREUM_CHAIN_ID = 1;
const USDC = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const UNISWAP_V3_USDC_WETH_005 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";

const TRANSFER_WINDOW_START_MS = Date.parse("2026-02-16T17:50:00.000Z");
const TRANSFER_WINDOW_END_MS = Date.parse("2026-02-16T17:51:00.000Z");
const SWAP_WINDOW_START_MS = Date.parse("2026-02-16T17:30:00.000Z");
const SWAP_WINDOW_END_MS = Date.parse("2026-02-16T17:40:00.000Z");

suite("HyperSync Integration", () => {
  const client = new HyperSyncClient();

  it("counts historical ERC20 transfers on a fixed mainnet window", async () => {
    const ref: RawEventRef = {
      type: "raw_event",
      source: "hypersync",
      chainId: ETHEREUM_CHAIN_ID,
      queries: [
        {
          eventSignature: "event Transfer(address indexed from, address indexed to, uint256 value)",
          topic0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          normalizer: "none",
        },
      ],
      contractAddresses: [USDC],
      aggregation: "count",
    };

    const result = await client.fetchRawEvents(
      ref,
      TRANSFER_WINDOW_START_MS,
      TRANSFER_WINDOW_END_MS,
    );

    expect(result).toBeGreaterThan(0);
  }, 90_000);

  it("counts historical swap logs through the normalized swap preset path", async () => {
    const ref: RawEventRef = {
      type: "raw_event",
      source: "hypersync",
      chainId: ETHEREUM_CHAIN_ID,
      queries: [
        {
          eventSignature:
            "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
          topic0: toEventSelector(
            "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
          ),
          normalizer: "uniswap_v3_swap",
        },
      ],
      contractAddresses: [UNISWAP_V3_USDC_WETH_005],
      aggregation: "count",
      filters: [{ field: "swap_protocol", op: "eq", value: "uniswap_v3" }],
    };

    const result = await client.fetchRawEvents(ref, SWAP_WINDOW_START_MS, SWAP_WINDOW_END_MS);

    expect(result).toBeGreaterThan(0);
  }, 90_000);
});
