import { pool } from "../db/index.ts";
import { getSourceCapabilities } from "../engine/source-capabilities.ts";
import { probeEnvioEndpoint } from "../envio/client.ts";
import { probeHyperSync } from "../hypersync/client.ts";
import { pingRedis } from "../redis/client.ts";
import {
  getConfiguredRpcChainIds,
  getRpcConfigurationStatus,
  probeRpcChain,
} from "../rpc/client.ts";
import { getErrorMessage } from "../utils/errors.ts";

type CheckStatus = "ok" | "error" | "disabled";

export interface DependencyCheck {
  status: CheckStatus;
  provider: string;
  optional: boolean;
  message: string;
}

export interface ReadinessReport {
  status: "ok" | "degraded";
  checked_at: string;
  ready: boolean;
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
    state: DependencyCheck;
    indexed: DependencyCheck;
    raw: DependencyCheck;
  };
}

const READINESS_TTL_MS = Number.parseInt(process.env.READINESS_CACHE_TTL_MS ?? "15000", 10);
const READINESS_TIMEOUT_MS = Number.parseInt(process.env.READINESS_TIMEOUT_MS ?? "5000", 10);

let cachedReport: { expiresAt: number; value: Promise<ReadinessReport> } | undefined;

function buildCheck(
  provider: string,
  optional: boolean,
  status: CheckStatus,
  message: string,
): DependencyCheck {
  return {
    status,
    provider,
    optional,
    message,
  };
}

async function collectReadiness(): Promise<ReadinessReport> {
  const capabilities = getSourceCapabilities();
  const rpcConfig = getRpcConfigurationStatus();
  const configuredChainIds = getConfiguredRpcChainIds();

  const [database, redis, state, indexed, raw] = await Promise.all([
    withTimeout(pool.query("SELECT 1"), READINESS_TIMEOUT_MS, "database readiness probe timed out")
      .then(() => buildCheck("postgres", false, "ok", "database connection verified"))
      .catch((error: unknown) => buildCheck("postgres", false, "error", getErrorMessage(error))),
    withTimeout(pingRedis(), READINESS_TIMEOUT_MS, "redis readiness probe timed out")
      .then(() => buildCheck("redis", false, "ok", "redis connection verified"))
      .catch((error: unknown) => buildCheck("redis", false, "error", getErrorMessage(error))),
    !rpcConfig.configured
      ? Promise.resolve(
          buildCheck("rpc", false, "error", rpcConfig.issues[0] ?? "rpc is not configured"),
        )
      : withTimeout(
          Promise.all(configuredChainIds.map((chainId) => probeRpcChain(chainId))),
          READINESS_TIMEOUT_MS,
          "rpc readiness probe timed out",
        )
          .then(() =>
            buildCheck(
              "rpc",
              false,
              "ok",
              `rpc providers verified for chains ${configuredChainIds.join(", ")}`,
            ),
          )
          .catch((error: unknown) => buildCheck("rpc", false, "error", getErrorMessage(error))),
    capabilities.indexed.enabled
      ? withTimeout(probeEnvioEndpoint(), READINESS_TIMEOUT_MS, "indexed readiness probe timed out")
          .then(() => buildCheck("envio", true, "ok", "indexed provider verified"))
          .catch((error: unknown) => buildCheck("envio", true, "error", getErrorMessage(error)))
      : Promise.resolve(
          buildCheck("envio", true, "disabled", "indexed provider is not configured"),
        ),
    capabilities.raw.enabled
      ? withTimeout(
          Promise.all(configuredChainIds.map((chainId) => probeHyperSync(chainId))),
          READINESS_TIMEOUT_MS,
          "raw readiness probe timed out",
        )
          .then(() =>
            buildCheck(
              "hypersync",
              true,
              "ok",
              `raw provider verified for chains ${configuredChainIds.join(", ")}`,
            ),
          )
          .catch((error: unknown) => buildCheck("hypersync", true, "error", getErrorMessage(error)))
      : Promise.resolve(
          buildCheck("hypersync", true, "disabled", "raw provider is not configured"),
        ),
  ]);

  const checks = { database, redis, state, indexed, raw };
  const ready = Object.values(checks).every((check) => check.status !== "error");

  return {
    status: ready ? "ok" : "degraded",
    checked_at: new Date().toISOString(),
    ready,
    checks,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export async function getReadinessReport(force = false): Promise<ReadinessReport> {
  const now = Date.now();
  if (!force && cachedReport && now < cachedReport.expiresAt) {
    return cachedReport.value;
  }

  const value = collectReadiness();
  cachedReport = {
    expiresAt: now + READINESS_TTL_MS,
    value,
  };

  try {
    return await value;
  } catch (error) {
    cachedReport = undefined;
    throw error;
  }
}
