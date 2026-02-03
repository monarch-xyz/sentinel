// Engine module exports

export { evaluateNode, evaluateCondition, EvaluationError, parseDuration } from './evaluator.js';
export type { EvalContext } from './evaluator.js';

export { SignalEvaluator } from './condition.js';
export type { SignalEvaluationResult } from './condition.js';

// DataFetcher abstraction
export type { DataFetcher, DataFetcherOptions } from './fetcher.js';

// Morpho-specific implementation
export { createMorphoFetcher } from './morpho-fetcher.js';

export {
  compileCondition,
  compileConditions,
  isGroupCondition,
  isSimpleCondition,
} from './compiler.js';
export type {
  CompiledCondition,
  CompiledGroupCondition,
  CompilationContext,
} from './compiler.js';

export {
  METRIC_REGISTRY,
  getMetric,
  isValidMetric,
  getMetricsByProtocol,
  listMetrics,
  getMetricsByKind,
} from './metrics.js';
export type { MetricDef, StateMetricDef, EventMetricDef, ComputedMetricDef, ChainedEventMetricDef } from './metrics.js';
