import { config } from "../config/index.js";
import {
  DeliveryIntegrationError,
  getTelegramIntegrationStatus,
} from "../integrations/delivery.js";
import { ValidationError } from "../utils/validation.js";

export interface ManagedSignalDelivery {
  provider: "telegram";
}

export interface SignalDeliveryInput {
  webhook_url?: string;
  delivery?: ManagedSignalDelivery;
}

const DELIVERY_WEBHOOK_PATH = "/webhook/deliver";

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getTelegramDeliveryWebhookUrl(): string {
  const baseUrl = normalizeBaseUrl(config.delivery.baseUrl);
  if (!baseUrl) {
    throw new DeliveryIntegrationError("Delivery integration is not configured", 503);
  }

  return `${baseUrl}${DELIVERY_WEBHOOK_PATH}`;
}

export function inferManagedSignalDelivery(webhookUrl: unknown): ManagedSignalDelivery | undefined {
  if (typeof webhookUrl !== "string" || webhookUrl.trim().length === 0) {
    return undefined;
  }

  try {
    if (webhookUrl.trim() === getTelegramDeliveryWebhookUrl()) {
      return { provider: "telegram" };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function resolveSignalWebhookUrl(
  input: SignalDeliveryInput,
  userId: string,
): Promise<string> {
  if (input.delivery?.provider === "telegram") {
    const managedWebhookUrl = getTelegramDeliveryWebhookUrl();
    if (input.webhook_url && input.webhook_url !== managedWebhookUrl) {
      throw new ValidationError("Provide either webhook_url or delivery, not both", "delivery");
    }

    const status = await getTelegramIntegrationStatus(userId);
    if (!status.linked) {
      throw new ValidationError("Telegram is not linked for this user", "delivery");
    }

    return managedWebhookUrl;
  }

  if (input.webhook_url) {
    return input.webhook_url;
  }

  throw new ValidationError("webhook_url or delivery is required", "webhook_url");
}
