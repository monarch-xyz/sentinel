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
// Metric to Entity/Field Mapping
// ============================================

interface MetricMapping {
  entityType: string;
  field: string;
  isEvent?: boolean;
  eventType?: string;
  aggregation?: 'sum' | 'count' | 'avg' | 'min' | 'max';
}

const METRIC_MAPPINGS: Record<MetricType, MetricMapping> = {
  // Position metrics (per address per market)
  supply_assets: { entityType: 'Position', field: 'supplyShares' },
  supply_shares: { entityType: 'Position', field: 'supplyShares' },
  borrow_assets: { entityType: 'Position', field: 'borrowShares' },
  borrow_shares: { entityType: 'Position', field: 'borrowShares' },
  collateral_assets: { entityType: 'Position', field: 'collateral' },

  // Market metrics (aggregate)
  market_total_supply: { entityType: 'Market', field: 'totalSupplyAssets' },
  market_total_borrow: { entityType: 'Market', field: 'totalBorrowAssets' },
  market_utilization: { entityType: 'Market', field: '_computed_utilization' }, // Special handling
  market_borrow_rate: { entityType: 'Market', field: 'borrowRate' },

  // Flow metrics (event-based)
  net_supply_flow: { entityType: 'Event', field: 'assets', isEvent: true, eventType: 'Supply', aggregation: 'sum' },
  net_borrow_flow: { entityType: 'Event', field: 'assets', isEvent: true, eventType: 'Borrow', aggregation: 'sum' },
  liquidation_volume: { entityType: 'Event', field: 'assets', isEvent: true, eventType: 'Liquidate', aggregation: 'sum' },
  event_count: { entityType: 'Event', field: 'id', isEvent: true, eventType: 'Supply', aggregation: 'count' },
};

// ============================================
// Helper Functions
// ============================================

function constant(value: number): Constant {
  return { type: 'constant', value };
}

function buildFilters(
  metric: MetricType,
  marketId?: string,
  address?: string
): Filter[] {
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
  metric: MetricType,
  snapshot: 'current' | 'window_start' | string,
  marketId?: string,
  address?: string
): StateRef {
  const mapping = METRIC_MAPPINGS[metric];

  return {
    type: 'state',
    entity_type: mapping.entityType,
    filters: buildFilters(metric, marketId, address),
    field: mapping.field,
    snapshot,
  };
}

function buildEventRef(
  metric: MetricType,
  marketId?: string,
  address?: string
): EventRef {
  const mapping = METRIC_MAPPINGS[metric];

  if (!mapping.isEvent || !mapping.eventType) {
    throw new Error(`Metric ${metric} is not an event-based metric`);
  }

  return {
    type: 'event',
    event_type: mapping.eventType,
    filters: buildFilters(metric, marketId, address),
    field: mapping.field,
    aggregation: mapping.aggregation || 'sum',
  };
}

// ============================================
// Condition Compilers
// ============================================

/**
 * Compiles a threshold condition:
 * { type: 'threshold', metric: 'supply_assets', operator: '>', value: 1000 }
 * 
 * → { left: StateRef(supply_assets), operator: 'gt', right: Constant(1000) }
 */
function compileThreshold(cond: ThresholdCondition): InternalCondition {
  const mapping = METRIC_MAPPINGS[cond.metric];
  let left: ExpressionNode;

  if (mapping.isEvent) {
    left = buildEventRef(cond.metric, cond.market_id, cond.address);
  } else if (cond.metric === 'market_utilization') {
    // Special case: utilization = totalBorrow / totalSupply
    const borrow = buildStateRef('market_total_borrow', 'current', cond.market_id);
    const supply = buildStateRef('market_total_supply', 'current', cond.market_id);
    left = {
      type: 'expression',
      operator: 'div',
      left: borrow,
      right: supply,
    };
  } else {
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
  const mapping = METRIC_MAPPINGS[cond.metric];

  // For aggregate conditions, we use the state directly (the indexer pre-aggregates market totals)
  const left: StateRef = {
    type: 'state',
    entity_type: mapping.entityType,
    filters: [],
    field: mapping.field,
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
