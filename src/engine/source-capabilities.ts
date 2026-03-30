import { config } from "../config/index.ts";
import { getRpcConfigurationStatus } from "../rpc/client.ts";
import type { Condition as DslCondition, SignalDefinition } from "../types/signal.ts";
import { type MetricDef, getMetric } from "./metrics.ts";

export type SourceFamily = "state" | "indexed" | "raw";
export type SourceProvider = "rpc" | "envio" | "hypersync";

export interface SourceCapability {
  family: SourceFamily;
  provider: SourceProvider;
  enabled: boolean;
  requiredEnv: string[];
  reason?: string;
}

export interface SourceCapabilities {
  state: SourceCapability;
  indexed: SourceCapability;
  raw: SourceCapability;
}

export interface SourceCapabilityConfig {
  envioEndpoint?: string;
  hypersyncApiToken?: string;
}

export interface SignalSourceUsage {
  families: SourceFamily[];
  metrics: Record<Exclude<SourceFamily, "raw">, string[]>;
  rawEventKinds: string[];
}

export class SourceCapabilityError extends Error {
  constructor(
    message: string,
    public readonly family: SourceFamily,
    public readonly provider: SourceProvider,
    public readonly requiredEnv: string[],
  ) {
    super(message);
    this.name = "SourceCapabilityError";
  }
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function buildCapabilityErrorMessage(capability: SourceCapability): string {
  if (capability.enabled) {
    return `${capability.family} source family is enabled`;
  }

  const envHint =
    capability.requiredEnv.length > 0
      ? ` Configure ${capability.requiredEnv.join(", ")} to enable it.`
      : "";

  return `${capability.family} source family is disabled because ${
    capability.reason ?? "required infrastructure is not configured"
  }.${envHint}`;
}

function buildUnavailableSourceMessage(
  capability: SourceCapability,
  reasonOverride?: string,
): string {
  if (!reasonOverride) {
    return buildCapabilityErrorMessage(capability);
  }

  const envHint =
    !capability.enabled && capability.requiredEnv.length > 0
      ? ` Configure ${capability.requiredEnv.join(", ")} to enable it.`
      : "";

  return `${capability.family} source family is unavailable because ${reasonOverride}.${envHint}`;
}

function collectMetricFamilies(
  metricName: string,
  visited = new Set<string>(),
): Set<Exclude<SourceFamily, "raw">> {
  if (visited.has(metricName)) return new Set();
  visited.add(metricName);

  const metric = getMetric(metricName);
  if (!metric) {
    throw new Error(`Unknown metric: "${metricName}"`);
  }

  return collectMetricFamiliesFromDef(metric, visited);
}

function collectMetricFamiliesFromDef(
  metric: MetricDef,
  visited: Set<string>,
): Set<Exclude<SourceFamily, "raw">> {
  switch (metric.kind) {
    case "state":
      return new Set(["state"]);
    case "event":
      return new Set(["indexed"]);
    case "computed":
    case "chained_event": {
      const families = new Set<Exclude<SourceFamily, "raw">>();
      for (const operand of metric.operands) {
        for (const family of collectMetricFamilies(operand, visited)) {
          families.add(family);
        }
      }
      return families;
    }
    default:
      return new Set();
  }
}

function collectConditionUsage(
  condition: DslCondition,
  metrics: Record<Exclude<SourceFamily, "raw">, Set<string>>,
  rawEventKinds: Set<string>,
  families: Set<SourceFamily>,
): void {
  switch (condition.type) {
    case "threshold":
    case "change":
    case "aggregate": {
      const metricFamilies = collectMetricFamilies(condition.metric);
      for (const family of metricFamilies) {
        families.add(family);
        metrics[family].add(condition.metric);
      }
      return;
    }
    case "raw-events":
      families.add("raw");
      rawEventKinds.add(condition.event.kind);
      return;
    case "group":
      for (const inner of condition.conditions) {
        collectConditionUsage(inner, metrics, rawEventKinds, families);
      }
      return;
    default:
      return;
  }
}

export function createSourceCapabilities(
  sourceConfig: SourceCapabilityConfig = {},
): SourceCapabilities {
  const envioEndpoint = sourceConfig.envioEndpoint?.trim() ?? "";
  const hypersyncApiToken = sourceConfig.hypersyncApiToken?.trim() ?? "";
  const rpcConfig = getRpcConfigurationStatus();
  const stateRequiredEnv =
    rpcConfig.supportedChains.length > 0
      ? ["SUPPORTED_CHAIN_IDS", ...rpcConfig.supportedChains.map((chain) => chain.rpcEnvVar)]
      : ["SUPPORTED_CHAIN_IDS"];

  return {
    state: {
      family: "state",
      provider: "rpc",
      enabled: rpcConfig.configured,
      requiredEnv: Array.from(new Set(stateRequiredEnv)),
      reason: rpcConfig.configured
        ? undefined
        : (rpcConfig.issues[0] ?? "archive RPC configuration is incomplete"),
    },
    indexed: {
      family: "indexed",
      provider: "envio",
      enabled: envioEndpoint.length > 0,
      requiredEnv: ["ENVIO_ENDPOINT"],
      reason: envioEndpoint.length > 0 ? undefined : "ENVIO_ENDPOINT is not configured",
    },
    raw: {
      family: "raw",
      provider: "hypersync",
      enabled: hypersyncApiToken.length > 0,
      requiredEnv: ["ENVIO_API_TOKEN"],
      reason: hypersyncApiToken.length > 0 ? undefined : "ENVIO_API_TOKEN is not configured",
    },
  };
}

export function getSourceCapabilities(): SourceCapabilities {
  return createSourceCapabilities({
    envioEndpoint: config.envio.endpoint,
    hypersyncApiToken: config.hypersync.apiToken,
  });
}

export function getDisabledSourceCapabilities(
  capabilities: SourceCapabilities = getSourceCapabilities(),
): SourceCapability[] {
  return Object.values(capabilities).filter((capability) => !capability.enabled);
}

export function collectSignalSourceUsage(definition: SignalDefinition): SignalSourceUsage {
  const metrics = {
    state: new Set<string>(),
    indexed: new Set<string>(),
  };
  const rawEventKinds = new Set<string>();
  const families = new Set<SourceFamily>();

  for (const condition of definition.conditions) {
    collectConditionUsage(condition, metrics, rawEventKinds, families);
  }

  return {
    families: Array.from(families),
    metrics: {
      state: uniqueSorted(metrics.state),
      indexed: uniqueSorted(metrics.indexed),
    },
    rawEventKinds: uniqueSorted(rawEventKinds),
  };
}

export function assertSignalDefinitionSourcesEnabled(
  definition: SignalDefinition,
  capabilities: SourceCapabilities = getSourceCapabilities(),
): void {
  const usage = collectSignalSourceUsage(definition);

  for (const family of usage.families) {
    const capability = capabilities[family];
    if (!capability.enabled) {
      throw new SourceCapabilityError(
        buildCapabilityErrorMessage(capability),
        capability.family,
        capability.provider,
        capability.requiredEnv,
      );
    }
  }
}

export function createSourceCapabilityError(
  family: SourceFamily,
  reasonOverride?: string,
  capabilities: SourceCapabilities = getSourceCapabilities(),
): SourceCapabilityError {
  const capability = capabilities[family];
  return new SourceCapabilityError(
    buildUnavailableSourceMessage(capability, reasonOverride),
    capability.family,
    capability.provider,
    capability.requiredEnv,
  );
}

export function getSourceCapabilityHealth(
  capabilities: SourceCapabilities = getSourceCapabilities(),
): Record<SourceFamily, Omit<SourceCapability, "family"> & { message: string }> {
  return {
    state: {
      provider: capabilities.state.provider,
      enabled: capabilities.state.enabled,
      requiredEnv: capabilities.state.requiredEnv,
      reason: capabilities.state.reason,
      message: buildCapabilityErrorMessage(capabilities.state),
    },
    indexed: {
      provider: capabilities.indexed.provider,
      enabled: capabilities.indexed.enabled,
      requiredEnv: capabilities.indexed.requiredEnv,
      reason: capabilities.indexed.reason,
      message: buildCapabilityErrorMessage(capabilities.indexed),
    },
    raw: {
      provider: capabilities.raw.provider,
      enabled: capabilities.raw.enabled,
      requiredEnv: capabilities.raw.requiredEnv,
      reason: capabilities.raw.reason,
      message: buildCapabilityErrorMessage(capabilities.raw),
    },
  };
}

export function getSourceCapabilityStatusLines(
  capabilities: SourceCapabilities = getSourceCapabilities(),
): string[] {
  return Object.values(capabilities).map((capability) =>
    capability.enabled
      ? `${capability.family} source family enabled via ${capability.provider}`
      : buildCapabilityErrorMessage(capability),
  );
}
