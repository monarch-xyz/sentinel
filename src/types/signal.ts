/**
 * Signal Types - Core domain types for Sentinel
 */

// ============================================
// Scope
// ============================================

export interface SignalScope {
  /** Chain IDs to monitor (e.g., [1, 8453]) */
  chains: number[];
  /** Morpho market IDs (optional) */
  markets?: string[];
  /** Addresses to track (optional) */
  addresses?: string[];
  /** Protocol filter */
  protocol?: "morpho" | "all";
}

// ============================================
// Time Window
// ============================================

export interface TimeWindow {
  /** Duration string (e.g., "1h", "7d", "30m") */
  duration: string;
}

// ============================================
// Metrics
// ============================================

/**
 * Metric names follow the pattern: {Protocol}.{Entity}.{field}
 *
 * Available metrics (see src/engine/metrics.ts for full list):
 * - Morpho.Position.supplyShares
 * - Morpho.Position.borrowShares
 * - Morpho.Position.collateral
 * - Morpho.Market.totalSupplyAssets
 * - Morpho.Market.totalBorrowAssets
 * - Morpho.Market.utilization (computed: borrow/supply)
 * - Morpho.Event.Supply.assets
 * - Morpho.Event.Withdraw.assets
 * - Morpho.Flow.netSupply (chained: Supply - Withdraw)
 * - Morpho.Flow.netBorrow (chained: Borrow - Repay)
 */
export type MetricType = string;

// ============================================
// Conditions
// ============================================

export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";

export interface ThresholdCondition {
  type: "threshold";
  metric: MetricType;
  operator: ComparisonOperator;
  value: number;
  /** Optional per-condition window override */
  window?: TimeWindow;
  /** Optional event-only filters (for event metrics) */
  filters?: Array<{
    field: string;
    op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
    value: string | number | boolean | Array<string | number>;
  }>;
  /** Chain ID (required) */
  chain_id: number;
  /** Market ID (required for Market/Position metrics) */
  market_id?: string;
  /** User address (required for Position metrics) */
  address?: string;
}

export interface ChangeCondition {
  type: "change";
  metric: MetricType;
  direction: "increase" | "decrease" | "any";
  by: { percent: number } | { absolute: number };
  /** Optional per-condition window override */
  window?: TimeWindow;
  /** Chain ID (required) */
  chain_id: number;
  /** Market ID (required for Market/Position metrics) */
  market_id?: string;
  /** User address (required for Position metrics) */
  address?: string;
}

export interface GroupCondition {
  type: "group";
  /** Addresses to check */
  addresses: string[];
  /** Optional per-condition window override */
  window?: TimeWindow;
  /** How inner conditions combine (default: AND) */
  logic?: "AND" | "OR";
  /** N of M requirement */
  requirement: {
    count: number;
    of: number;
  };
  /** Conditions each address must meet */
  conditions: Condition[];
}

export interface AggregateCondition {
  type: "aggregate";
  aggregation: "sum" | "avg" | "min" | "max" | "count";
  metric: MetricType;
  operator: ComparisonOperator;
  value: number;
  /** Optional per-condition window override */
  window?: TimeWindow;
  /** Optional event-only filters (for event metrics) */
  filters?: Array<{
    field: string;
    op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
    value: string | number | boolean | Array<string | number>;
  }>;
  /** Chain ID (required) */
  chain_id: number;
  /** Market ID (optional for aggregation) */
  market_id?: string;
}

export type Condition = ThresholdCondition | ChangeCondition | GroupCondition | AggregateCondition;

// ============================================
// Signal Definition
// ============================================

export interface SignalDefinition {
  scope: SignalScope;
  conditions: Condition[];
  /** How conditions combine (default: AND) */
  logic?: "AND" | "OR";
  window: TimeWindow;
}
