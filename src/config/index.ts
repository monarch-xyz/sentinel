/**
 * Flare Configuration
 */

import "dotenv/config";

export const config = {
  // Database
  database: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/flare",
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
  },

  // API
  api: {
    port: Number.parseInt(process.env.API_PORT ?? "3000", 10),
    host: process.env.API_HOST ?? "0.0.0.0",
  },

  // Worker
  worker: {
    intervalSeconds: Number.parseInt(process.env.WORKER_INTERVAL_SECONDS ?? "30", 10),
  },

  // Envio
  envio: {
    endpoint: process.env.ENVIO_ENDPOINT ?? "",
    validateSchema:
      process.env.ENVIO_VALIDATE_SCHEMA !== undefined
        ? process.env.ENVIO_VALIDATE_SCHEMA === "true"
        : process.env.NODE_ENV !== "test",
  },

  // Webhook
  webhook: {
    timeoutMs: Number.parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? "10000", 10),
    maxRetries: Number.parseInt(process.env.WEBHOOK_MAX_RETRIES ?? "3", 10),
    secret: process.env.WEBHOOK_SECRET ?? "",
  },

  // Logging
  log: {
    level: process.env.LOG_LEVEL ?? "info",
  },

  // Environment
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV !== "production",
} as const;

export type Config = typeof config;
