import { createHmac } from "node:crypto";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookPayload } from "../../src/types/index.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const payload: WebhookPayload = {
  signal_id: "signal-1",
  signal_name: "Test Signal",
  triggered_at: "2025-01-01T00:00:00.000Z",
  scope: { chains: [1] },
  conditions_met: [],
  context: {},
};

describe("Webhook signing", () => {
  const originalSecret = process.env.WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      // biome-ignore lint/performance/noDelete: delete is correct for env vars (undefined becomes "undefined" string)
      delete process.env.WEBHOOK_SECRET;
    } else {
      process.env.WEBHOOK_SECRET = originalSecret;
    }
  });

  it("adds X-Flare-Signature when WEBHOOK_SECRET is set", async () => {
    process.env.WEBHOOK_SECRET = "test-secret";
    vi.resetModules();

    const { dispatchNotification } = await import("../../src/worker/notifier.js");
    await dispatchNotification("https://example.com/webhook", payload, 5000);

    const options = mockedAxios.post.mock.calls[0][2];
    const payloadJson = JSON.stringify(payload);
    const timestamp = options.headers["X-Flare-Timestamp"];
    const digest = createHmac("sha256", "test-secret")
      .update(`${timestamp}.${payloadJson}`)
      .digest("hex");

    expect(options.headers).toMatchObject({
      "X-Flare-Signature": `sha256=${digest}`,
    });
  });

  it("skips signing when WEBHOOK_SECRET is empty", async () => {
    // biome-ignore lint/performance/noDelete: delete is correct for env vars (undefined becomes "undefined" string)
    delete process.env.WEBHOOK_SECRET;
    vi.resetModules();

    const { dispatchNotification } = await import("../../src/worker/notifier.js");
    await dispatchNotification("https://example.com/webhook", payload, 5000);

    const options = mockedAxios.post.mock.calls[0][2];
    expect(options.headers).not.toHaveProperty("X-Flare-Signature");
  });
});
