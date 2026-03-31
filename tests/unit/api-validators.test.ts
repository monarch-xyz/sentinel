import { describe, expect, it } from "vitest";
import { CreateSignalSchema } from "../../src/api/validators.ts";

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

  it("accepts broader well-known raw event presets", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "ERC721 transfer count",
        definition: {
          scope: { chains: [1] },
          window: { duration: "1h" },
          conditions: [
            {
              type: "raw-events",
              aggregation: "count",
              operator: ">",
              value: 1,
              event: {
                kind: "erc721_transfer",
              },
            },
          ],
        },
        webhook_url: "https://example.com/webhook",
        cooldown_minutes: 5,
      }),
    ).not.toThrow();
  });

  it("accepts ERC1155 approval-for-all preset", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "ERC1155 approval for all count",
        definition: {
          scope: { chains: [1] },
          window: { duration: "1h" },
          conditions: [
            {
              type: "raw-events",
              aggregation: "count",
              operator: ">",
              value: 1,
              event: {
                kind: "erc1155_approval_for_all",
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

  it("accepts telegram-managed delivery without a webhook url", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "Telegram managed",
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
        delivery: { provider: "telegram" },
        cooldown_minutes: 5,
      }),
    ).not.toThrow();
  });

  it("rejects signature for non-contract-event presets", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "Invalid signature on preset",
        definition: {
          scope: { chains: [1] },
          window: { duration: "1h" },
          conditions: [
            {
              type: "raw-events",
              aggregation: "count",
              operator: ">",
              value: 0,
              event: {
                kind: "erc20_transfer",
                signature: "Transfer(address indexed from, address indexed to, uint256 value)",
              },
            },
          ],
        },
        webhook_url: "https://example.com/webhook",
        cooldown_minutes: 5,
      }),
    ).toThrow("signature is only supported for contract_event raw-events");
  });

  it("rejects protocols for non-swap presets", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "Invalid protocols on preset",
        definition: {
          scope: { chains: [1] },
          window: { duration: "1h" },
          conditions: [
            {
              type: "raw-events",
              aggregation: "count",
              operator: ">",
              value: 0,
              event: {
                kind: "erc20_approval",
                protocols: ["uniswap_v2"],
              },
            },
          ],
        },
        webhook_url: "https://example.com/webhook",
        cooldown_minutes: 5,
      }),
    ).toThrow("protocols are only supported for swap raw-events");
  });

  it("rejects whitespace-only signature for contract_event presets", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "Invalid blank contract event signature",
        definition: {
          scope: { chains: [1] },
          window: { duration: "1h" },
          conditions: [
            {
              type: "raw-events",
              aggregation: "count",
              operator: ">",
              value: 0,
              event: {
                kind: "contract_event",
                signature: "   ",
              },
            },
          ],
        },
        webhook_url: "https://example.com/webhook",
        cooldown_minutes: 5,
      }),
    ).toThrow("signature is required for contract_event raw-events");
  });

  it("accepts create requests that include delivery plus the resolved managed webhook url", () => {
    expect(() =>
      CreateSignalSchema.parse({
        name: "Ambiguous destination",
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
        webhook_url: "http://delivery:3100/webhook/deliver",
        delivery: { provider: "telegram" },
        cooldown_minutes: 5,
      }),
    ).not.toThrow();
  });
});
