/**
 * Signal Types - Core domain types for Sentinel
 */

import type { RawEventKind, RawEventSwapProtocol } from "./raw-events.js";

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

export interface ConditionFilter {
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
  value: string | number | boolean | Array<string | number>;
}

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
  filters?: ConditionFilter[];
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
  filters?: ConditionFilter[];
  /** Chain ID (required) */
  chain_id: number;
  /** Market ID (optional for aggregation) */
  market_id?: string;
}

export interface RawEventSpec {
  /** Prebuilt preset for common events. */
  kind: RawEventKind;
  /** Optional contract address filter for the emitting contracts. */
  contract_addresses?: string[];
  /**
   * Full ABI event signature for generic events.
   *
   * Example:
   * "Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
   */
  signature?: string;
  /**
   * Optional swap protocol presets to include. If omitted for `kind = "swap"`,
   * Sentinel queries all supported swap presets.
   */
  protocols?: RawEventSwapProtocol[];
}

export interface RawEventsCondition {
  type: "raw-events";
  aggregation: "sum" | "avg" | "min" | "max" | "count";
  operator: ComparisonOperator;
  value: number;
  /** Decoded event field to aggregate. Optional only for count. */
  field?: string;
  /** Optional per-condition window override */
  window?: TimeWindow;
  /** Optional filters evaluated against decoded event arguments and metadata fields. */
  filters?: ConditionFilter[];
  /** Chain ID (required unless it can be inferred from scope) */
  chain_id?: number;
  /** Raw event definition executed via HyperSync. */
  event: RawEventSpec;
}

export type Condition =
  | ThresholdCondition
  | ChangeCondition
  | GroupCondition
  | AggregateCondition
  | RawEventsCondition;

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
