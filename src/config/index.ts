/**
 * Sentinel Configuration
 */

import "dotenv/config";

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const config = {
  // Database
  database: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/sentinel",
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

  // Auth
  auth: {
    // If set, /api/v1/auth/register requires X-Admin-Key with this value.
    registerAdminKey: process.env.REGISTER_ADMIN_KEY ?? "",
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "sentinel_session",
    sessionTtlHours: Number.parseInt(process.env.SESSION_TTL_HOURS ?? "720", 10),
    nonceTtlMinutes: Number.parseInt(process.env.NONCE_TTL_MINUTES ?? "10", 10),
    siweDomain: process.env.AUTH_SIWE_DOMAIN ?? "localhost:3000",
    siweUri: process.env.AUTH_SIWE_URI ?? "http://localhost:3000",
  },

  // Worker
  worker: {
    intervalSeconds: Number.parseInt(process.env.WORKER_INTERVAL_SECONDS ?? "30", 10),
    runScheduler:
      process.env.WORKER_RUN_SCHEDULER !== undefined
        ? process.env.WORKER_RUN_SCHEDULER === "true"
        : true,
  },

  // Envio
  envio: {
    endpoint: readEnv("ENVIO_ENDPOINT"),
    validateSchema:
      process.env.ENVIO_VALIDATE_SCHEMA !== undefined
        ? process.env.ENVIO_VALIDATE_SCHEMA === "true"
        : process.env.NODE_ENV !== "test",
  },

  hypersync: {
    apiToken: readEnv("ENVIO_API_TOKEN"),
    maxLogsPerRequest: readPositiveIntegerEnv("HYPERSYNC_MAX_LOGS_PER_REQUEST", 10000),
    maxLogsPerQuery: readPositiveIntegerEnv("HYPERSYNC_MAX_LOGS_PER_QUERY", 100000),
    maxPagesPerQuery: readPositiveIntegerEnv("HYPERSYNC_MAX_PAGES_PER_QUERY", 25),
  },

  // Webhook
  webhook: {
    timeoutMs: Number.parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? "10000", 10),
    maxRetries: Number.parseInt(process.env.WEBHOOK_MAX_RETRIES ?? "3", 10),
    secret: process.env.WEBHOOK_SECRET ?? "",
  },

  // Optional internal delivery integration
  delivery: {
    baseUrl: process.env.DELIVERY_BASE_URL ?? "http://localhost:3100",
    adminKey: process.env.DELIVERY_ADMIN_KEY ?? process.env.WEBHOOK_SECRET ?? "",
    timeoutMs: Number.parseInt(process.env.DELIVERY_TIMEOUT_MS ?? "5000", 10),
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
