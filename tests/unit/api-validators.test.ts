import { describe, expect, it } from "vitest";
import { CreateSignalSchema } from "../../src/api/validators.js";

describe("CreateSignalSchema", () => {
  it("accepts count-based raw-events without a field", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "Raw count",
        definition: {
          scope: { chains: [1] },
          window: { duration: "1h" },
          conditions: [
            {
              type: "raw-events",
              aggregation: "count",
              operator: ">",
              value: 5,
              event: {
                kind: "erc20_transfer",
              },
            },
          ],
        },
        webhook_url: "https://example.com/webhook",
        cooldown_minutes: 5,
      }),
    ).not.toThrow();
  });

  it("rejects non-count raw-events without a field", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "Raw sum missing field",
        definition: {
          scope: { chains: [1] },
          window: { duration: "1h" },
          conditions: [
            {
              type: "raw-events",
              aggregation: "sum",
              operator: ">",
              value: 5,
              event: {
                kind: "erc20_transfer",
              },
            },
          ],
        },
        webhook_url: "https://example.com/webhook",
        cooldown_minutes: 5,
      }),
    ).toThrow("field is required for raw-events aggregation unless aggregation is count");
  });
});
