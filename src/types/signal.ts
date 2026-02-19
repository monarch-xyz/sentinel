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
  /** Optional: override with block-based lookback */
  lookback_blocks?: number;
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

// ============================================
// Signal Entity
// ============================================

export interface Signal {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  definition: SignalDefinition;
  webhook_url: string;
  cooldown_minutes: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_triggered_at?: Date;
  last_evaluated_at?: Date;
}

export interface CreateSignalInput {
  user_id: string;
  name: string;
  description?: string;
  definition: SignalDefinition;
  webhook_url: string;
  cooldown_minutes?: number;
}

export interface UpdateSignalInput {
  name?: string;
  description?: string;
  definition?: SignalDefinition;
  webhook_url?: string;
  cooldown_minutes?: number;
  is_active?: boolean;
}

// ============================================
// Evaluation
// ============================================

export interface ConditionResult {
  type: string;
  triggered: boolean;
  description: string;
  actual_value?: number;
  threshold?: number;
  details?: Record<string, unknown>;
}

export interface EvaluationResult {
  signal_id: string;
  triggered: boolean;
  evaluated_at: Date;
  conditions_met: ConditionResult[];
  context: Record<string, unknown>;
}

// ============================================
// Webhook
// ============================================

export interface WebhookPayload {
  signal_id: string;
  signal_name: string;
  triggered_at: string;
  scope: {
    chains: number[];
    markets?: string[];
    addresses?: string[];
  };
  conditions_met: ConditionResult[];
  context: {
    app_user_id: string;
    address?: string;
    market_id?: string;
    chain_id?: number;
  };
}

// ============================================
// Notification Log
// ============================================

export interface NotificationLog {
  id: string;
  signal_id: string;
  triggered_at: Date;
  payload: WebhookPayload;
  webhook_status?: number;
  webhook_response_time_ms?: number;
  retry_count: number;
  created_at: Date;
}
