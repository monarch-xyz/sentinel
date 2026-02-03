/**
 * Metric Registry - Extensible metric definitions
 * 
 * This module defines the mapping between user-facing metric names
 * and the underlying data sources. New protocols/entities can be added
 * by extending the registry.
 * 
 * Naming convention: {Protocol}.{Entity}.{field}
 */

import { Filter } from '../types/index.js';

// ============================================
// Metric Definition Types
// ============================================

export interface StateMetricDef {
  kind: 'state';
  /** Entity type in the indexer (e.g., "Position", "Market") */
  entity: string;
  /** Field name in the entity */
  field: string;
}

export interface ComputedMetricDef {
  kind: 'computed';
  /** Type of computation */
  computation: 'ratio' | 'difference';
  /** The metrics used in computation [numerator, denominator] or [left, right] */
  operands: [string, string];
  /** Human-readable description */
  description: string;
}

export interface EventMetricDef {
  kind: 'event';
  /** Event type in the indexer */
  eventType: string;
  /** Field to aggregate */
  field: string;
  /** Default aggregation method */
  aggregation: 'sum' | 'count' | 'avg' | 'min' | 'max';
}

export interface ChainedEventMetricDef {
  kind: 'chained_event';
  /** Operation to combine events */
  operation: 'add' | 'sub';
  /** The event metrics to combine [left, right] */
  operands: [string, string];
  /** Human-readable description */
  description: string;
}

export type MetricDef = StateMetricDef | ComputedMetricDef | EventMetricDef | ChainedEventMetricDef;

// ============================================
// Metric Registry
// ============================================

export const METRIC_REGISTRY: Record<string, MetricDef> = {
  // ============================================
  // Morpho Position Metrics (State)
  // ============================================
  'Morpho.Position.supplyShares': {
    kind: 'state',
    entity: 'Position',
    field: 'supplyShares',
  },
  'Morpho.Position.borrowShares': {
    kind: 'state',
    entity: 'Position',
    field: 'borrowShares',
  },
  'Morpho.Position.collateral': {
    kind: 'state',
    entity: 'Position',
    field: 'collateral',
  },

  // ============================================
  // Morpho Market Metrics (State)
  // ============================================
  'Morpho.Market.totalSupplyAssets': {
    kind: 'state',
    entity: 'Market',
    field: 'totalSupplyAssets',
  },
  'Morpho.Market.totalBorrowAssets': {
    kind: 'state',
    entity: 'Market',
    field: 'totalBorrowAssets',
  },
  'Morpho.Market.totalSupplyShares': {
    kind: 'state',
    entity: 'Market',
    field: 'totalSupplyShares',
  },
  'Morpho.Market.totalBorrowShares': {
    kind: 'state',
    entity: 'Market',
    field: 'totalBorrowShares',
  },
  'Morpho.Market.fee': {
    kind: 'state',
    entity: 'Market',
    field: 'fee',
  },

  // ============================================
  // Morpho Market Metrics (Computed)
  // ============================================
  'Morpho.Market.utilization': {
    kind: 'computed',
    computation: 'ratio',
    operands: ['Morpho.Market.totalBorrowAssets', 'Morpho.Market.totalSupplyAssets'],
    description: 'totalBorrowAssets / totalSupplyAssets',
  },

  // ============================================
  // Morpho Event Metrics (Single Event)
  // ============================================
  'Morpho.Event.Supply.assets': {
    kind: 'event',
    eventType: 'Morpho_Supply',
    field: 'assets',
    aggregation: 'sum',
  },
  'Morpho.Event.Withdraw.assets': {
    kind: 'event',
    eventType: 'Morpho_Withdraw',
    field: 'assets',
    aggregation: 'sum',
  },
  'Morpho.Event.Borrow.assets': {
    kind: 'event',
    eventType: 'Morpho_Borrow',
    field: 'assets',
    aggregation: 'sum',
  },
  'Morpho.Event.Repay.assets': {
    kind: 'event',
    eventType: 'Morpho_Repay',
    field: 'assets',
    aggregation: 'sum',
  },
  'Morpho.Event.Liquidate.repaidAssets': {
    kind: 'event',
    eventType: 'Morpho_Liquidate',
    field: 'repaidAssets',
    aggregation: 'sum',
  },
  'Morpho.Event.Liquidate.seizedAssets': {
    kind: 'event',
    eventType: 'Morpho_Liquidate',
    field: 'seizedAssets',
    aggregation: 'sum',
  },

  // ============================================
  // Morpho Chained Event Metrics (Computed from Events)
  // ============================================
  'Morpho.Flow.netSupply': {
    kind: 'chained_event',
    operation: 'sub',
    operands: ['Morpho.Event.Supply.assets', 'Morpho.Event.Withdraw.assets'],
    description: 'sum(Supply.assets) - sum(Withdraw.assets)',
  },
  'Morpho.Flow.netBorrow': {
    kind: 'chained_event',
    operation: 'sub',
    operands: ['Morpho.Event.Borrow.assets', 'Morpho.Event.Repay.assets'],
    description: 'sum(Borrow.assets) - sum(Repay.assets)',
  },
  'Morpho.Flow.totalLiquidations': {
    kind: 'chained_event',
    operation: 'add',
    operands: ['Morpho.Event.Liquidate.repaidAssets', 'Morpho.Event.Liquidate.seizedAssets'],
    description: 'sum(repaidAssets) + sum(seizedAssets)',
  },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get a metric definition by name
 */
export function getMetric(name: string): MetricDef | undefined {
  return METRIC_REGISTRY[name];
}

/**
 * Check if a metric exists
 */
export function isValidMetric(name: string): boolean {
  return name in METRIC_REGISTRY;
}

/**
 * Get all metrics for a specific protocol
 */
export function getMetricsByProtocol(protocol: string): Record<string, MetricDef> {
  const prefix = `${protocol}.`;
  const result: Record<string, MetricDef> = {};
  
  for (const [name, def] of Object.entries(METRIC_REGISTRY)) {
    if (name.startsWith(prefix)) {
      result[name] = def;
    }
  }
  
  return result;
}

/**
 * List all available metric names
 */
export function listMetrics(): string[] {
  return Object.keys(METRIC_REGISTRY);
}

/**
 * Get metrics by kind
 */
export function getMetricsByKind(kind: MetricDef['kind']): Record<string, MetricDef> {
  const result: Record<string, MetricDef> = {};
  
  for (const [name, def] of Object.entries(METRIC_REGISTRY)) {
    if (def.kind === kind) {
      result[name] = def;
    }
  }
  
  return result;
}
