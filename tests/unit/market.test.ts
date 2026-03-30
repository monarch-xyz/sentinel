import { describe, expect, it } from "vitest";
import { normalizeMarketId } from "../../src/utils/market.ts";

describe("normalizeMarketId", () => {
  it("extracts a bytes32 market id from a market URL", () => {
    expect(
      normalizeMarketId(
        "https://www.monarchlend.xyz/market/8453/0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda",
      ),
    ).toBe("0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda");
  });
});
