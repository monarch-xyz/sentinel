import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTelegramIntegrationStatus = vi.fn();

vi.mock("../../src/integrations/delivery.ts", async () => {
  const actual = await vi.importActual("../../src/integrations/delivery.ts");
  return {
    ...actual,
    getTelegramIntegrationStatus: mockGetTelegramIntegrationStatus,
  };
});

describe("signal delivery resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DELIVERY_BASE_URL = "http://delivery:3100";
  });

  it("resolves telegram-managed delivery server-side", async () => {
    mockGetTelegramIntegrationStatus.mockResolvedValue({
      provider: "telegram",
      linked: true,
      app_user_id: "user-1",
    });

    const { resolveSignalWebhookUrl } = await import("../../src/api/signal-delivery.ts");
    await expect(
      resolveSignalWebhookUrl({ delivery: { provider: "telegram" } }, "user-1"),
    ).resolves.toBe("http://delivery:3100/webhook/deliver");
  });

  it("rejects telegram-managed delivery when telegram is not linked", async () => {
    mockGetTelegramIntegrationStatus.mockResolvedValue({
      provider: "telegram",
      linked: false,
      app_user_id: "user-1",
    });

    const { resolveSignalWebhookUrl } = await import("../../src/api/signal-delivery.ts");
    await expect(
      resolveSignalWebhookUrl({ delivery: { provider: "telegram" } }, "user-1"),
    ).rejects.toThrow("Telegram is not linked for this user");
  });

  it("infers telegram-managed delivery from the internal delivery webhook", async () => {
    const { inferManagedSignalDelivery } = await import("../../src/api/signal-delivery.ts");
    expect(inferManagedSignalDelivery("http://delivery:3100/webhook/deliver")).toEqual({
      provider: "telegram",
    });
  });

  it("rejects conflicting webhook_url and managed delivery", async () => {
    mockGetTelegramIntegrationStatus.mockResolvedValue({
      provider: "telegram",
      linked: true,
      app_user_id: "user-1",
    });

    const { resolveSignalWebhookUrl } = await import("../../src/api/signal-delivery.ts");
    await expect(
      resolveSignalWebhookUrl(
        {
          webhook_url: "https://example.com/webhook",
          delivery: { provider: "telegram" },
        },
        "user-1",
      ),
    ).rejects.toThrow("Provide either webhook_url or delivery, not both");
  });
});
