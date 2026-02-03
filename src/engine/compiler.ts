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
 * Result of compiling an aggregate condition - evaluated across scope.
 */
export interface CompiledAggregateCondition {
  type: 'aggregate';
  aggregation: AggregateCondition['aggregation'];
  metric: MetricType;
  operator: ComparisonOp;
  value: number;
  chainId: number;
  marketIds?: string[];
  addresses?: string[];
}

/**
 * A compiled condition - either a simple condition or a group
 */
export type CompiledCondition = InternalCondition | CompiledGroupCondition | CompiledAggregateCondition;

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
      `Unknown metric: "${metricName}". Use qualified names like "Morpho.Position.supplyShares".`
    );
  }
  return metric;
}

// ============================================
// Validation
// ============================================

/**
 * Get the entity type for a metric (Position, Market, or Event)
 */
function getMetricEntity(metricName: string): string {
  const metric = resolveMetric(metricName);
  if (metric.kind === 'state') return metric.entity;
  if (metric.kind === 'computed') {
    // Computed metrics derive from their operands - check first operand
    const firstOperand = resolveMetric(metric.operands[0]);
    return firstOperand.kind === 'state' ? firstOperand.entity : 'Event';
  }
  if (metric.kind === 'event' || metric.kind === 'chained_event') return 'Event';
  return 'Unknown';
}

/**
 * Validate required filters based on metric type.
 *
 * For group conditions, address validation is skipped because the address
 * is provided by the group evaluator at runtime, not at compile time.
 */
function validateRequiredFilters(
  metricName: string,
  chainId?: number,
  marketId?: string,
  address?: string,
  isGroupInner = false
): void {
  const entity = getMetricEntity(metricName);

  // All metrics require chain_id
  if (chainId === undefined) {
    throw new Error(`chain_id is required for metric "${metricName}"`);
  }

  if (entity === 'Position') {
    if (!marketId) {
      throw new Error(`market_id is required for Position metric "${metricName}"`);
    }
    // For group inner conditions, address is provided at eval time, not compile time
    if (!address && !isGroupInner) {
      throw new Error(`address is required for Position metric "${metricName}"`);
    }
  } else if (entity === 'Market') {
    if (!marketId) {
      throw new Error(`market_id is required for Market metric "${metricName}"`);
    }
  }
  // Event metrics: chain_id is enough (market_id/address are optional filters)
}

// ============================================
// Helper Functions
// ============================================

function constant(value: number): Constant {
  return { type: 'constant', value };
}

/**
 * Build filters for state/event refs.
 *
 * For group conditions, address is NOT included in filters at compile time.
 * The group evaluator adds the user filter at evaluation time for each address.
 */
function buildFilters(chainId: number, marketId?: string, address?: string): Filter[] {
  const filters: Filter[] = [];

  // Chain ID is always required
  filters.push({ field: 'chainId', op: 'eq', value: chainId });

  if (marketId) {
    filters.push({ field: 'marketId', op: 'eq', value: marketId });
  }

  if (address) {
    filters.push({ field: 'user', op: 'eq', value: address });
  }
  // For group conditions: NO user filter added here - group evaluator adds it at eval time

  return filters;
}

function buildStateRef(
  metricName: string,
  snapshot: 'current' | 'window_start' | string,
  chainId: number,
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
    filters: buildFilters(chainId, marketId, address),
    field: metric.field,
    snapshot,
  };
}

function buildEventRef(
  metricName: string,
  chainId: number,
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
    filters: buildFilters(chainId, marketId, address),
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
  chainId: number,
  marketId?: string,
  address?: string
): BinaryExpression {
  const metric = getMetric(metricName);

  if (!metric || metric.kind !== 'chained_event') {
    throw new Error(`Metric "${metricName}" is not a chained event metric`);
  }

  const [leftMetric, rightMetric] = metric.operands;
  const leftEvent = buildEventRef(leftMetric, chainId, marketId, address);
  const rightEvent = buildEventRef(rightMetric, chainId, marketId, address);

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
  chainId: number,
  marketId?: string,
  address?: string
): BinaryExpression {
  const metric = getMetric(metricName);

  if (!metric || metric.kind !== 'computed') {
    throw new Error(`Metric "${metricName}" is not a computed metric`);
  }

  const [leftMetric, rightMetric] = metric.operands;
  const leftState = buildStateRef(leftMetric, snapshot, chainId, marketId, address);
  const rightState = buildStateRef(rightMetric, snapshot, chainId, marketId, address);

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

/**
 * Builds an expression for a metric (state, event, computed, chained).
 */
export function buildMetricExpression(
  metricName: string,
  snapshot: 'current' | 'window_start' | string,
  chainId: number,
  marketId?: string,
  address?: string
): ExpressionNode {
  if (isChainedEventMetric(metricName)) {
    return buildChainedEventExpression(metricName, chainId, marketId, address);
  }
  if (isEventMetric(metricName)) {
    return buildEventRef(metricName, chainId, marketId, address);
  }
  if (isComputedMetric(metricName)) {
    return buildComputedExpression(metricName, snapshot, chainId, marketId, address);
  }
  return buildStateRef(metricName, snapshot, chainId, marketId, address);
}

// ============================================
// Condition Compilers
// ============================================

type CompileOptions = {
  /** Compiling inner condition of a group (address provided at eval time) */
  isGroupInner?: boolean;
};

/**
 * Compiles a threshold condition:
 * { type: 'threshold', metric: 'Morpho.Position.supplyShares', operator: '>', value: 1000, chain_id: 1, market_id: '0x...', address: '0x...' }
 *
 * → { left: StateRef(supplyShares), operator: 'gt', right: Constant(1000) }
 */
function compileThreshold(cond: ThresholdCondition, opts: CompileOptions = {}): InternalCondition {
  // Validate required filters (address validation skipped for group inner conditions)
  validateRequiredFilters(cond.metric, cond.chain_id, cond.market_id, cond.address, opts.isGroupInner);

  let left: ExpressionNode;

  if (isChainedEventMetric(cond.metric)) {
    // Chained events: e.g., Morpho.Flow.netSupply = Supply - Withdraw
    left = buildChainedEventExpression(cond.metric, cond.chain_id, cond.market_id, cond.address);
  } else if (isEventMetric(cond.metric)) {
    // Single event aggregation
    left = buildEventRef(cond.metric, cond.chain_id, cond.market_id, cond.address);
  } else if (isComputedMetric(cond.metric)) {
    // Computed state metrics: e.g., Morpho.Market.utilization = borrow / supply
    left = buildComputedExpression(cond.metric, 'current', cond.chain_id, cond.market_id, cond.address);
  } else {
    // Simple state metric (address may be undefined for group inner conditions)
    left = buildStateRef(cond.metric, 'current', cond.chain_id, cond.market_id, cond.address);
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
 * { type: 'change', metric: 'Morpho.Position.supplyShares', direction: 'decrease', by: { percent: 10 }, chain_id: 1, market_id: '0x...', address: '0x...' }
 *
 * For percent decrease: current < past * (1 - percent/100)
 * For percent increase: current > past * (1 + percent/100)
 * For absolute decrease: (past - current) > absolute
 * For absolute increase: (current - past) > absolute
 */
function compileChange(cond: ChangeCondition, opts: CompileOptions = {}): InternalCondition {
  // Validate required filters (address validation skipped for group inner conditions)
  validateRequiredFilters(cond.metric, cond.chain_id, cond.market_id, cond.address, opts.isGroupInner);

  if (cond.direction === 'any') {
    throw new Error('Change direction "any" is not supported yet');
  }

  // For group inner conditions, address may be undefined - added at eval time
  const current = buildStateRef(cond.metric, 'current', cond.chain_id, cond.market_id, cond.address);
  const past = buildStateRef(cond.metric, 'window_start', cond.chain_id, cond.market_id, cond.address);

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
 * handles differently (evaluates per-address, then counts matches).
 *
 * The inner condition is compiled WITHOUT an address filter - the group
 * evaluator adds the user filter for each address at evaluation time.
 */
function compileGroup(cond: GroupCondition): CompiledGroupCondition {
  // Compile the inner condition with isGroupInner=true
  // This skips address validation and omits user from filters
  const innerCompiled = compileCondition(cond.condition, { isGroupInner: true });

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
 * { type: 'aggregate', aggregation: 'sum', metric: 'Morpho.Market.totalSupplyAssets', operator: '>', value: 1000000, chain_id: 1 }
 * 
 * This creates an event-based aggregation across the scope
 */
function compileAggregate(cond: AggregateCondition): CompiledAggregateCondition {
  // Validate chain_id is required
  if (cond.chain_id === undefined) {
    throw new Error(`chain_id is required for aggregate condition`);
  }

  resolveMetric(cond.metric);

  return {
    type: 'aggregate',
    aggregation: cond.aggregation,
    metric: cond.metric,
    operator: OPERATOR_MAP[cond.operator],
    value: cond.value,
    chainId: cond.chain_id,
    marketIds: cond.market_id ? [cond.market_id] : undefined,
  };
}

// ============================================
// Main Compiler Entry Point
// ============================================

/**
 * Compiles a user-friendly condition into an internal expression tree
 */
export function compileCondition(cond: UserCondition, opts: CompileOptions = {}): CompiledCondition {
  switch (cond.type) {
    case 'threshold':
      return compileThreshold(cond, opts);
    case 'change':
      return compileChange(cond, opts);
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
    conditions: conditions.map((c) => compileCondition(c)),
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
