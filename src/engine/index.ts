// Engine module exports

export { evaluateNode, evaluateCondition, EvaluationError, parseDuration } from "./evaluator.ts";
export type { EvalContext } from "./evaluator.ts";

export { SignalEvaluator } from "./condition.ts";
export type { SignalEvaluationResult } from "./condition.ts";

// DataFetcher abstraction
export type {
  DataFetcher,
  DataFetcherOptions,
  IndexedEventFetcher,
  IndexingDataClient,
} from "./fetcher.ts";

// Morpho-specific implementation
export { createMorphoFetcher } from "./morpho-fetcher.ts";
export {
  planGenericRpcStateRead,
  planIndexedEventRead,
  planRawEventRead,
} from "./source-plan.ts";
export type {
  PlannedArchiveRpcExecution,
  PlannedEnvioEventRead,
  PlannedGenericRpcStateRead,
  PlannedIndexedEventRead,
  PlannedRawEventRead,
} from "./source-plan.ts";
export {
  createSourceCapabilityError,
  SourceCapabilityError,
  assertSignalDefinitionSourcesEnabled,
  collectSignalSourceUsage,
  createSourceCapabilities,
  getDisabledSourceCapabilities,
  getSourceCapabilities,
  getSourceCapabilityHealth,
} from "./source-capabilities.ts";
export type {
  SignalSourceUsage,
  SourceCapabilities,
  SourceCapability,
  SourceFamily,
  SourceProvider,
} from "./source-capabilities.ts";

export {
  compileCondition,
  compileConditions,
  isGroupCondition,
  isSimpleCondition,
} from "./compiler.ts";
export type {
  CompiledCondition,
  CompiledAggregateCondition,
  CompiledGroupCondition,
} from "./compiler.ts";

export {
  METRIC_REGISTRY,
  getMetric,
  isValidMetric,
  getMetricsByProtocol,
  listMetrics,
  getMetricsByKind,
} from "./metrics.ts";
export type {
  MetricDef,
  StateMetricDef,
  EventMetricDef,
  ComputedMetricDef,
  ChainedEventMetricDef,
} from "./metrics.ts";
