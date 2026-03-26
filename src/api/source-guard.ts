import { normalizeStoredDefinition } from "../engine/compile-signal.js";
import {
  type SourceCapabilityError,
  assertSignalDefinitionSourcesEnabled,
} from "../engine/source-capabilities.js";

export function assertStoredDefinitionSourcesEnabled(definition: unknown): void {
  const storedDefinition = normalizeStoredDefinition(definition);
  assertSignalDefinitionSourcesEnabled(storedDefinition.dsl);
}

export function formatSourceCapabilityError(error: SourceCapabilityError) {
  return {
    error: error.message,
    family: error.family,
    provider: error.provider,
    required_env: error.requiredEnv,
  };
}
