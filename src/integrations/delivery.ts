import axios, { isAxiosError } from "axios";
import { config } from "../config/index.js";

export interface TelegramIntegrationStatus {
  provider: "telegram";
  linked: boolean;
  app_user_id: string;
  telegram_username?: string | null;
  linked_at?: string | null;
}

export class DeliveryIntegrationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "DeliveryIntegrationError";
  }
}

function assertDeliveryConfigured(): void {
  if (!config.delivery.baseUrl.trim() || !config.delivery.adminKey.trim()) {
    throw new DeliveryIntegrationError("Delivery integration is not configured", 503);
  }
}

function deliveryHeaders(): Record<string, string> {
  assertDeliveryConfigured();
  return {
    "X-Admin-Key": config.delivery.adminKey,
  };
}

function toDeliveryError(error: unknown): DeliveryIntegrationError {
  if (isAxiosError(error)) {
    const statusCode = error.response?.status ?? 502;
    const message =
      typeof error.response?.data?.error === "string" ? error.response.data.error : error.message;
    return new DeliveryIntegrationError(message, statusCode);
  }

  if (error instanceof DeliveryIntegrationError) {
    return error;
  }

  return new DeliveryIntegrationError(error instanceof Error ? error.message : String(error), 500);
}

export async function getTelegramIntegrationStatus(
  appUserId: string,
): Promise<TelegramIntegrationStatus> {
  try {
    const response = await axios.get<TelegramIntegrationStatus>(
      `${config.delivery.baseUrl}/internal/integrations/telegram/${encodeURIComponent(appUserId)}`,
      {
        headers: deliveryHeaders(),
        timeout: config.delivery.timeoutMs,
      },
    );
    return response.data;
  } catch (error) {
    throw toDeliveryError(error);
  }
}

export async function linkTelegramIntegration(
  appUserId: string,
  token: string,
): Promise<TelegramIntegrationStatus> {
  try {
    const response = await axios.post<TelegramIntegrationStatus>(
      `${config.delivery.baseUrl}/internal/integrations/telegram/${encodeURIComponent(appUserId)}/link`,
      { token },
      {
        headers: deliveryHeaders(),
        timeout: config.delivery.timeoutMs,
      },
    );
    return response.data;
  } catch (error) {
    throw toDeliveryError(error);
  }
}
