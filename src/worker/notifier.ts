import { createHmac } from "node:crypto";
import axios, { isAxiosError } from "axios";
import { config } from "../config/index.js";
import type { WebhookPayload } from "../types/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("worker:notifier");

export interface NotificationResult {
  success: boolean;
  status?: number;
  error?: string;
  durationMs: number;
  attempts?: number;
}

export async function dispatchNotification(
  url: string,
  payload: WebhookPayload,
  timeoutMs: number = config.webhook.timeoutMs,
): Promise<NotificationResult> {
  const start = Date.now();
  const payloadJson = JSON.stringify(payload);
  const maxAttempts = Math.max(1, config.webhook.maxRetries + 1);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Flare-Notification-Service/1.0",
  };

  headers["Idempotency-Key"] = `${payload.signal_id}:${payload.triggered_at}`;
  const timestamp = new Date().toISOString();
  headers["X-Flare-Timestamp"] = timestamp;

  const secret = config.webhook.secret;
  if (secret) {
    const digest = createHmac("sha256", secret).update(`${timestamp}.${payloadJson}`).digest("hex");
    headers["X-Flare-Signature"] = `sha256=${digest}`;
  }

  let lastErrorMessage = "Unknown error";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await axios.post(url, payloadJson, {
        timeout: timeoutMs,
        headers,
      });

      return {
        success: true,
        status: response.status,
        durationMs: Date.now() - start,
        attempts: attempt,
      };
    } catch (error: unknown) {
      lastErrorMessage = getErrorMessage(error);
      lastStatus = isAxiosError(error) ? error.response?.status : undefined;

      const retryable =
        lastStatus === undefined || lastStatus === 429 || (lastStatus >= 500 && lastStatus <= 599);

      if (!retryable || attempt >= maxAttempts) {
        logger.error({ url, error: lastErrorMessage }, "Webhook delivery failed");
        break;
      }

      const backoffMs = Math.min(500 * 2 ** (attempt - 1), 5000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return {
    success: false,
    status: lastStatus,
    error: lastErrorMessage,
    durationMs: Date.now() - start,
    attempts: maxAttempts,
  };
}
