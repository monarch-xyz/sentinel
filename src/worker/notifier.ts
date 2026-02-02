import axios from 'axios';
import { WebhookPayload } from '../types/index.js';
import pino from 'pino';

const logger = pino();

export interface NotificationResult {
  success: boolean;
  status?: number;
  error?: string;
  durationMs: number;
}

/**
 * Core Notification Dispatcher
 * 
 * Flare follows a strict "everything is a webhook" architecture.
 * Specific channels (Telegram, Discord) are reached via external tunnel services.
 */
export async function dispatchNotification(
  url: string,
  payload: WebhookPayload,
  timeoutMs = 10000
): Promise<NotificationResult> {
  const start = Date.now();
  
  try {
    const response = await axios.post(url, payload, {
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Flare-Notification-Service/1.0',
      },
    });

    return {
      success: true,
      status: response.status,
      durationMs: Date.now() - start,
    };
  } catch (error: any) {
    logger.error({ url, error: error.message }, 'Webhook delivery failed');
    
    return {
      success: false,
      status: error.response?.status,
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}
