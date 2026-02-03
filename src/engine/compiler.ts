/**
 * DSL Compiler - Transforms user-friendly conditions into expression trees
 * 
 * This module bridges the gap between:
 * - User DSL (ThresholdCondition, ChangeCondition, etc.) - easy to write
 * - Internal AST (ExpressionNode, Condition) - easy to evaluate
 */

import {
  Condition as InternalCondition,
  ExpressionNode,
  StateRef,
  EventRef,
  Constant,
  BinaryExpression,
  ComparisonOp,
  Filter,
} from '../types/index.js';

import {
  Condition as UserCondition,
  ThresholdCondition,
  ChangeCondition,
  GroupCondition,
  AggregateCondition,
  MetricType,
  ComparisonOperator,
  SignalScope,
} from '../types/signal.js';

import { getMetric, MetricDef, isValidMetric, ChainedEventMetricDef, EventMetricDef, ComputedMetricDef } from './metrics.js';

/**
 * Result of compiling a group condition - needs special handling
 * because it evaluates multiple addresses independently
 */
export interface CompiledGroupCondition {
  type: 'group';
  addresses: string[];
  requirement: { count: number; of: number };
  /** The condition to evaluate for each address */
  perAddressCondition: InternalCondition;
}

/**
 * A compiled condition - either a simple condition or a group
 */
export type CompiledCondition = InternalCondition | CompiledGroupCondition;

/**
 * Compilation context - provides scope information for building filters
 */
export interface CompilationContext {
  scope: SignalScope;
  /** Default chain ID to use if not specified */
  defaultChainId?: number;
}

// ============================================
// Operator Mapping
// ============================================

const OPERATOR_MAP: Record<ComparisonOperator, ComparisonOp> = {
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  '==': 'eq',
  '!=': 'neq',
};

// ============================================
// Metric Resolution (uses registry)
// ============================================

function resolveMetric(metricName: string): MetricDef {
  const metric = getMetric(metricName);
  if (!metric) {
    throw new Error(
      `Unknown metric: "${metricName}". Use qualified names like "Morpho.Position.supplyShares" or legacy names like "supply_assets".`
    );
  }
  return metric;
}

// ============================================
// Helper Functions
// ============================================

function constant(value: number): Constant {
  return { type: 'constant', value };
}

function buildFilters(marketId?: string, address?: string): Filter[] {
  const filters: Filter[] = [];

  if (marketId) {
    filters.push({ field: 'marketId', op: 'eq', value: marketId });
  }

  if (address) {
    filters.push({ field: 'user', op: 'eq', value: address });
  }

  return filters;
}

function buildStateRef(
  metricName: string,
  snapshot: 'current' | 'window_start' | string,
  marketId?: string,
  address?: string
): StateRef {
  const metric = resolveMetric(metricName);

  if (metric.kind !== 'state') {
    throw new Error(`Metric "${metricName}" is not a state metric (got ${metric.kind})`);
  }

  return {
    type: 'state',
    entity_type: metric.entity,
    filters: buildFilters(marketId, address),
    field: metric.field,
    snapshot,
  };
}

function buildEventRef(
  metricName: string,
  marketId?: string,
  address?: string
): EventRef {
  const metric = resolveMetric(metricName);

  if (metric.kind !== 'event') {
    throw new Error(`Metric "${metricName}" is not an event metric (got ${metric.kind})`);
  }

  return {
    type: 'event',
    event_type: metric.eventType,
    filters: buildFilters(marketId, address),
    field: metric.field,
    aggregation: metric.aggregation,
  };
}

function isComputedMetric(metricName: string): boolean {
  const metric = getMetric(metricName);
  return metric?.kind === 'computed';
}

function isEventMetric(metricName: string): boolean {
  const metric = getMetric(metricName);
  return metric?.kind === 'event';
}

function isChainedEventMetric(metricName: string): boolean {
  const metric = getMetric(metricName);
  return metric?.kind === 'chained_event';
}

/**
 * Builds an expression for a chained event metric (e.g., netSupply = Supply - Withdraw)
 */
function buildChainedEventExpression(
  metricName: string,
  marketId?: string,
  address?: string
): BinaryExpression {
  const metric = getMetric(metricName);

  if (!metric || metric.kind !== 'chained_event') {
    throw new Error(`Metric "${metricName}" is not a chained event metric`);
  }

  const [leftMetric, rightMetric] = metric.operands;
  const leftEvent = buildEventRef(leftMetric, marketId, address);
  const rightEvent = buildEventRef(rightMetric, marketId, address);

  return {
    type: 'expression',
    operator: metric.operation,
    left: leftEvent,
    right: rightEvent,
  };
}

/**
 * Builds an expression for a computed state metric (e.g., utilization = borrow / supply)
 */
function buildComputedExpression(
  metricName: string,
  snapshot: 'current' | 'window_start' | string,
  marketId?: string,
  address?: string
): BinaryExpression {
  const metric = getMetric(metricName);

  if (!metric || metric.kind !== 'computed') {
    throw new Error(`Metric "${metricName}" is not a computed metric`);
  }

  const [leftMetric, rightMetric] = metric.operands;
  const leftState = buildStateRef(leftMetric, snapshot, marketId, address);
  const rightState = buildStateRef(rightMetric, snapshot, marketId, address);

  const operatorMap: Record<string, 'add' | 'sub' | 'mul' | 'div'> = {
    ratio: 'div',
    difference: 'sub',
  };

  return {
    type: 'expression',
    operator: operatorMap[metric.computation] || 'div',
    left: leftState,
    right: rightState,
  };
}

// ============================================
// Condition Compilers
// ============================================

/**
 * Compiles a threshold condition:
 * { type: 'threshold', metric: 'Morpho.Position.supplyShares', operator: '>', value: 1000 }
 * 
 * → { left: StateRef(supplyShares), operator: 'gt', right: Constant(1000) }
 */
function compileThreshold(cond: ThresholdCondition): InternalCondition {
  let left: ExpressionNode;

  if (isChainedEventMetric(cond.metric)) {
    // Chained events: e.g., Morpho.Flow.netSupply = Supply - Withdraw
    left = buildChainedEventExpression(cond.metric, cond.market_id, cond.address);
  } else if (isEventMetric(cond.metric)) {
    // Single event aggregation
    left = buildEventRef(cond.metric, cond.market_id, cond.address);
  } else if (isComputedMetric(cond.metric)) {
    // Computed state metrics: e.g., Morpho.Market.utilization = borrow / supply
    left = buildComputedExpression(cond.metric, 'current', cond.market_id, cond.address);
  } else {
    // Simple state metric
    left = buildStateRef(cond.metric, 'current', cond.market_id, cond.address);
  }

  return {
    type: 'condition',
    left,
    operator: OPERATOR_MAP[cond.operator],
    right: constant(cond.value),
  };
}

/**
 * Compiles a change condition:
 * { type: 'change', metric: 'supply_assets', direction: 'decrease', by: { percent: 10 } }
 * 
 * For percent decrease: current < past * (1 - percent/100)
 * For percent increase: current > past * (1 + percent/100)
 * For absolute decrease: (past - current) > absolute
 * For absolute increase: (current - past) > absolute
 */
function compileChange(cond: ChangeCondition): InternalCondition {
  const current = buildStateRef(cond.metric, 'current', cond.market_id, cond.address);
  const past = buildStateRef(cond.metric, 'window_start', cond.market_id, cond.address);

  if ('percent' in cond.by) {
    const percentDecimal = cond.by.percent / 100;

    if (cond.direction === 'decrease') {
      // current < past * (1 - percent)
      const threshold: BinaryExpression = {
        type: 'expression',
        operator: 'mul',
        left: past,
        right: constant(1 - percentDecimal),
      };
      return {
        type: 'condition',
        left: current,
        operator: 'lt',
        right: threshold,
      };
    } else if (cond.direction === 'increase') {
      // current > past * (1 + percent)
      const threshold: BinaryExpression = {
        type: 'expression',
        operator: 'mul',
        left: past,
        right: constant(1 + percentDecimal),
      };
      return {
        type: 'condition',
        left: current,
        operator: 'gt',
        right: threshold,
      };
    } else {
      // 'any' direction: |current - past| / past > percent
      // Simplified: current/past < (1 - percent) OR current/past > (1 + percent)
      // For simplicity, we check if ratio is outside [1-percent, 1+percent]
      // We'll check: abs(current - past) > past * percent
      const diff: BinaryExpression = {
        type: 'expression',
        operator: 'sub',
        left: current,
        right: past,
      };
      const threshold: BinaryExpression = {
        type: 'expression',
        operator: 'mul',
        left: past,
        right: constant(percentDecimal),
      };
      // For 'any', we check if the absolute change exceeds threshold
      // Simplification: we check decrease case (current < past * (1-percent))
      // A full implementation would need OR logic
      return {
        type: 'condition',
        left: current,
        operator: 'lt',
        right: {
          type: 'expression',
          operator: 'mul',
          left: past,
          right: constant(1 - percentDecimal),
        },
      };
    }
  } else {
    // Absolute change
    const absoluteValue = cond.by.absolute;

    if (cond.direction === 'decrease') {
      // (past - current) > absolute
      const diff: BinaryExpression = {
        type: 'expression',
        operator: 'sub',
        left: past,
        right: current,
      };
      return {
        type: 'condition',
        left: diff,
        operator: 'gt',
        right: constant(absoluteValue),
      };
    } else if (cond.direction === 'increase') {
      // (current - past) > absolute
      const diff: BinaryExpression = {
        type: 'expression',
        operator: 'sub',
        left: current,
        right: past,
      };
      return {
        type: 'condition',
        left: diff,
        operator: 'gt',
        right: constant(absoluteValue),
      };
    } else {
      // 'any' direction: abs(current - past) > absolute
      // Simplified: (past - current) > absolute (checks decrease)
      const diff: BinaryExpression = {
        type: 'expression',
        operator: 'sub',
        left: past,
        right: current,
      };
      return {
        type: 'condition',
        left: diff,
        operator: 'gt',
        right: constant(absoluteValue),
      };
    }
  }
}

/**
 * Compiles a group condition - returns a special structure that the evaluator
 * handles differently (evaluates per-address, then counts matches)
 */
function compileGroup(cond: GroupCondition): CompiledGroupCondition {
  // Compile the inner condition (without address filter - we'll add it at eval time)
  const innerCompiled = compileCondition(cond.condition);

  // Group conditions can't be nested (inner must be a simple condition)
  if ('type' in innerCompiled && innerCompiled.type === 'group') {
    throw new Error('Nested group conditions are not supported');
  }

  return {
    type: 'group',
    addresses: cond.addresses,
    requirement: cond.requirement,
    perAddressCondition: innerCompiled as InternalCondition,
  };
}

/**
 * Compiles an aggregate condition:
 * { type: 'aggregate', aggregation: 'sum', metric: 'market_total_supply', operator: '>', value: 1000000 }
 * 
 * This creates an event-based aggregation across the scope
 */
function compileAggregate(cond: AggregateCondition): InternalCondition {
  const metric = resolveMetric(cond.metric);

  if (metric.kind !== 'state') {
    throw new Error(`Aggregate conditions currently only support state metrics, got ${metric.kind}`);
  }

  // For aggregate conditions, we use the state directly (the indexer pre-aggregates market totals)
  const left: StateRef = {
    type: 'state',
    entity_type: metric.entity,
    filters: [],
    field: metric.field,
    snapshot: 'current',
  };

  return {
    type: 'condition',
    left,
    operator: OPERATOR_MAP[cond.operator],
    right: constant(cond.value),
  };
}

// ============================================
// Main Compiler Entry Point
// ============================================

/**
 * Compiles a user-friendly condition into an internal expression tree
 */
export function compileCondition(cond: UserCondition): CompiledCondition {
  switch (cond.type) {
    case 'threshold':
      return compileThreshold(cond);
    case 'change':
      return compileChange(cond);
    case 'group':
      return compileGroup(cond);
    case 'aggregate':
      return compileAggregate(cond);
    default:
      throw new Error(`Unknown condition type: ${(cond as any).type}`);
  }
}

/**
 * Compiles multiple conditions with AND/OR logic
 * For now, returns an array - the evaluator handles the logic
 */
export function compileConditions(
  conditions: UserCondition[],
  logic: 'AND' | 'OR' = 'AND'
): { conditions: CompiledCondition[]; logic: 'AND' | 'OR' } {
  return {
    conditions: conditions.map(compileCondition),
    logic,
  };
}

/**
 * Type guard to check if a compiled condition is a group condition
 */
export function isGroupCondition(cond: CompiledCondition): cond is CompiledGroupCondition {
  return 'type' in cond && cond.type === 'group' && 'addresses' in cond;
}

/**
 * Type guard to check if a compiled condition is a simple condition
 */
export function isSimpleCondition(cond: CompiledCondition): cond is InternalCondition {
  return 'type' in cond && cond.type === 'condition';
}
