// Engine module exports

export { evaluateNode, evaluateCondition, EvaluationError, parseDuration } from "./evaluator.js";
export type { EvalContext } from "./evaluator.js";

export { SignalEvaluator } from "./condition.js";
export type { SignalEvaluationResult } from "./condition.js";

// DataFetcher abstraction
export type {
  DataFetcher,
  DataFetcherOptions,
  IndexedEventFetcher,
  IndexingDataClient,
} from "./fetcher.js";

// Morpho-specific implementation
export { createMorphoFetcher } from "./morpho-fetcher.js";
export {
  bindMorphoRpcStateRead,
  planGenericRpcStateRead,
  planMorphoEventRead,
  planMorphoRawEventRead,
  planMorphoStateRead,
  planRpcStateRead,
} from "./source-plan.js";
export type {
  PlannedEnvioEventRead,
  PlannedGenericRpcStateRead,
  PlannedIndexedEventRead,
  PlannedMorphoRpcStateRead,
  PlannedRawEventRead,
  PlannedRpcStateRead,
} from "./source-plan.js";
export {
  createSourceCapabilityError,
  SourceCapabilityError,
  assertSignalDefinitionSourcesEnabled,
  collectSignalSourceUsage,
  createSourceCapabilities,
  getDisabledSourceCapabilities,
  getSourceCapabilities,
  getSourceCapabilityHealth,
} from "./source-capabilities.js";
export type {
  SignalSourceUsage,
  SourceCapabilities,
  SourceCapability,
  SourceFamily,
  SourceProvider,
} from "./source-capabilities.js";

export {
  compileCondition,
  compileConditions,
  isGroupCondition,
  isSimpleCondition,
} from "./compiler.js";
export type {
  CompiledCondition,
  CompiledAggregateCondition,
  CompiledGroupCondition,
} from "./compiler.js";

export {
  METRIC_REGISTRY,
  getMetric,
  isValidMetric,
  getMetricsByProtocol,
  listMetrics,
  getMetricsByKind,
} from "./metrics.js";
export type {
  MetricDef,
  StateMetricDef,
  EventMetricDef,
  ComputedMetricDef,
  ChainedEventMetricDef,
} from "./metrics.js";
