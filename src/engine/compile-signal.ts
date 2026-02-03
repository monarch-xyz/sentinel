/**
 * DSL Compilation - converts user-facing SignalDefinition into internal AST
 * while applying scope defaults and enforcing supported subsets.
 */

import { ValidationError, validateChains, validateCondition, validateDuration } from '../utils/validation.js';
import { Condition as AstCondition, ComparisonOp } from '../types/index.js';
import {
  SignalDefinition,
  Condition as DslCondition,
  ThresholdCondition,
  ChangeCondition,
  GroupCondition,
  AggregateCondition,
  ComparisonOperator,
  SignalScope,
} from '../types/signal.js';
import {
  compileCondition,
  isSimpleCondition,
  type CompiledAggregateCondition,
  type CompiledCondition,
} from './compiler.js';
import { getMetric } from './metrics.js';

export interface CompiledSignalDefinition {
  chains: number[];
  window: { duration: string };
  conditions: CompiledCondition[];
  logic: 'AND' | 'OR';
  /** Backwards-compatible single condition field (when applicable). */
  condition?: AstCondition;
}

export interface StoredSignalDefinition {
  version: 1;
  dsl: SignalDefinition;
  ast: CompiledSignalDefinition;
}

const OPERATOR_MAP: Record<ComparisonOperator, ComparisonOp> = {
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  '==': 'eq',
  '!=': 'neq',
};

function getMetricEntity(metricName: string): 'Position' | 'Market' | 'Event' | 'Unknown' {
  const metric = getMetric(metricName);
  if (!metric) {
    throw new ValidationError(`Unknown metric: "${metricName}"`, 'metric');
  }
  if (metric.kind === 'state') return metric.entity as 'Position' | 'Market';
  if (metric.kind === 'computed') {
    return getMetricEntity(metric.operands[0]);
  }
  if (metric.kind === 'event' || metric.kind === 'chained_event') return 'Event';
  return 'Unknown';
}

function enforceScopeContains<T>(
  scopeValues: T[] | undefined,
  provided: T | undefined,
  field: string
): void {
  if (!scopeValues || provided === undefined) return;
  if (!scopeValues.includes(provided)) {
    throw new ValidationError(`${field} is not included in scope`, field);
  }
}

function selectFromScope<T>(
  scopeValues: T[] | undefined,
  field: string
): T {
  if (!scopeValues || scopeValues.length === 0) {
    throw new ValidationError(`${field} is required`, field);
  }
  if (scopeValues.length > 1) {
    throw new ValidationError(`${field} is ambiguous (scope has multiple values)`, field);
  }
  return scopeValues[0]!;
}

function applyScopeToCondition(
  cond: DslCondition,
  scope: SignalScope,
  options: { includeAddress?: boolean } = {}
): DslCondition {
  if (cond.type === 'group' || cond.type === 'aggregate') {
    return cond;
  }

  const includeAddress = options.includeAddress !== false;

  const metricEntity = getMetricEntity(cond.metric);

  const chainId = cond.chain_id ?? selectFromScope(scope.chains, 'chain_id');
  enforceScopeContains(scope.chains, chainId, 'chain_id');

  let marketId = cond.market_id;
  if (!marketId) {
    if (metricEntity === 'Position' || metricEntity === 'Market' || metricEntity === 'Event') {
      if (scope.markets) {
        marketId = selectFromScope(scope.markets, 'market_id');
      }
    }
  }
  enforceScopeContains(scope.markets, marketId, 'market_id');

  let address = cond.address;
  if (!includeAddress && address) {
    throw new ValidationError('address must not be set inside a group condition', 'address');
  }
  if (includeAddress) {
    if (!address) {
      if (metricEntity === 'Position' || metricEntity === 'Event') {
        if (scope.addresses) {
          address = selectFromScope(scope.addresses, 'address');
        }
      }
    }
    enforceScopeContains(scope.addresses, address, 'address');
  }

  if (cond.type === 'threshold') {
    const next: ThresholdCondition = {
      ...cond,
      chain_id: chainId,
      market_id: marketId,
      address,
    };
    return next;
  }

  const next: ChangeCondition = {
    ...cond,
    chain_id: chainId,
    market_id: marketId,
    address,
  };
  return next;
}

function compileGroupWithScope(cond: GroupCondition, scope: SignalScope): CompiledCondition {
  if (!cond.addresses || cond.addresses.length === 0) {
    throw new ValidationError('Group conditions require at least one address', 'addresses');
  }
  if (cond.requirement.of !== cond.addresses.length) {
    throw new ValidationError('Group requirement.of must equal number of addresses', 'requirement.of');
  }
  if (cond.requirement.count <= 0 || cond.requirement.count > cond.addresses.length) {
    throw new ValidationError('Group requirement.count must be within address count', 'requirement.count');
  }
  if (scope.addresses) {
    for (const address of cond.addresses) {
      if (!scope.addresses.includes(address)) {
        throw new ValidationError('Group address not included in scope', 'addresses');
      }
    }
  }
  if (cond.condition.type === 'group' || cond.condition.type === 'aggregate') {
    throw new ValidationError('Nested group/aggregate conditions are not supported', 'condition');
  }

  const inner =
    cond.condition.type === 'threshold' || cond.condition.type === 'change'
      ? applyScopeToCondition(cond.condition, scope, { includeAddress: false })
      : cond.condition;

  let compiledInner: ReturnType<typeof compileCondition>;
  try {
    compiledInner = compileCondition(inner, { isGroupInner: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compile group condition';
    throw new ValidationError(message, 'condition');
  }

  if (!isSimpleCondition(compiledInner)) {
    throw new ValidationError('Group inner condition must be a simple condition', 'condition');
  }

  return {
    type: 'group',
    addresses: cond.addresses,
    requirement: cond.requirement,
    perAddressCondition: compiledInner,
  };
}

function compileAggregateWithScope(
  cond: AggregateCondition,
  scope: SignalScope
): CompiledAggregateCondition {
  const chainId = cond.chain_id ?? selectFromScope(scope.chains, 'chain_id');
  enforceScopeContains(scope.chains, chainId, 'chain_id');

  if (cond.market_id) {
    enforceScopeContains(scope.markets, cond.market_id, 'market_id');
  }

  const metricEntity = getMetricEntity(cond.metric);
  const marketIds = cond.market_id ? [cond.market_id] : scope.markets;
  const addresses = scope.addresses;

  if (metricEntity === 'Market' && (!marketIds || marketIds.length === 0)) {
    throw new ValidationError('market_id or scope.markets is required for market aggregation', 'market_id');
  }
  if (metricEntity === 'Position') {
    if (!marketIds || marketIds.length === 0) {
      throw new ValidationError('market_id or scope.markets is required for position aggregation', 'market_id');
    }
    if (!addresses || addresses.length === 0) {
      throw new ValidationError('scope.addresses is required for position aggregation', 'addresses');
    }
  }

  return {
    type: 'aggregate',
    aggregation: cond.aggregation,
    metric: cond.metric,
    operator: OPERATOR_MAP[cond.operator],
    value: cond.value,
    chainId,
    marketIds,
    addresses,
  };
}

function compileDslCondition(cond: DslCondition, scope: SignalScope): CompiledCondition {
  if (cond.type === 'group') {
    return compileGroupWithScope(cond, scope);
  }
  if (cond.type === 'aggregate') {
    return compileAggregateWithScope(cond, scope);
  }

  const scopedCondition = applyScopeToCondition(cond, scope);
  return compileCondition(scopedCondition);
}

function normalizeCompiledDefinition(definition: CompiledSignalDefinition): CompiledSignalDefinition {
  const conditions = Array.isArray(definition.conditions)
    ? definition.conditions
    : definition.condition
      ? [definition.condition]
      : [];
  const logic = definition.logic ?? 'AND';
  const condition =
    definition.condition ??
    (conditions.length === 1 && isSimpleCondition(conditions[0])
      ? (conditions[0] as AstCondition)
      : undefined);

  return {
    chains: definition.chains,
    window: definition.window,
    conditions,
    logic,
    ...(condition ? { condition } : {}),
  };
}

export function compileSignalDefinition(definition: SignalDefinition): StoredSignalDefinition {
  if (!definition || !definition.scope) {
    throw new ValidationError('Signal definition must include scope', 'definition.scope');
  }

  validateChains(definition.scope.chains);
  validateDuration(definition.window.duration, 'window.duration');

  if (!definition.conditions || definition.conditions.length === 0) {
    throw new ValidationError('At least one condition is required', 'conditions');
  }

  const compiledConditions: CompiledCondition[] = [];

  for (const rawCondition of definition.conditions) {
    let compiled: CompiledCondition;
    try {
      compiled = compileDslCondition(rawCondition, definition.scope);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to compile condition';
      throw new ValidationError(message, 'conditions');
    }

    if (isSimpleCondition(compiled)) {
      validateCondition(compiled);
    } else if (compiled.type === 'group') {
      validateCondition(compiled.perAddressCondition);
    }

    compiledConditions.push(compiled);
  }

  const logic = definition.logic ?? 'AND';
  const condition =
    compiledConditions.length === 1 && isSimpleCondition(compiledConditions[0])
      ? (compiledConditions[0] as AstCondition)
      : undefined;

  const ast = normalizeCompiledDefinition({
    chains: definition.scope.chains,
    window: { duration: definition.window.duration },
    conditions: compiledConditions,
    logic,
    ...(condition ? { condition } : {}),
  });

  return {
    version: 1,
    dsl: definition,
    ast,
  };
}

function isStoredDefinition(definition: any): definition is StoredSignalDefinition {
  return !!definition && typeof definition === 'object' && definition.version === 1 && definition.dsl && definition.ast;
}

function isCompiledDefinition(definition: any): definition is CompiledSignalDefinition {
  return (
    !!definition &&
    typeof definition === 'object' &&
    Array.isArray(definition.chains) &&
    definition.window &&
    ('conditions' in definition || 'condition' in definition)
  );
}

function isDslDefinition(definition: any): definition is SignalDefinition {
  return !!definition && typeof definition === 'object' && definition.scope && Array.isArray(definition.conditions);
}

export function normalizeStoredDefinition(definition: unknown): StoredSignalDefinition {
  if (isStoredDefinition(definition)) {
    return {
      ...definition,
      ast: normalizeCompiledDefinition(definition.ast),
    };
  }

  if (isCompiledDefinition(definition)) {
    return {
      version: 1,
      dsl: {
        scope: { chains: definition.chains },
        window: definition.window,
        conditions: [],
        logic: definition.logic,
      },
      ast: normalizeCompiledDefinition(definition),
    };
  }

  if (isDslDefinition(definition)) {
    return compileSignalDefinition(definition);
  }

  throw new ValidationError('Unsupported signal definition format', 'definition');
}
