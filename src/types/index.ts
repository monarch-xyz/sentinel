export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";

export interface Filter {
  field: string;
  op: FilterOp;
  value: string | number | boolean | Array<string | number>;
}

export interface EventRef {
  type: "event";
  /** Indexed event aggregation backed by Envio GraphQL. */
  event_type: string;
  filters: Filter[];
  field: string;
  aggregation: "sum" | "count" | "avg" | "min" | "max";
  /** Optional custom window duration (e.g., "2d", "7d"). Overrides signal-level window. */
  window?: string;
}

export type RawEventNormalizer = "none" | "uniswap_v2_swap" | "uniswap_v3_swap";

export interface RawEventQuery {
  eventSignature: string;
  topic0: string;
  normalizer: RawEventNormalizer;
}

export interface RawEventRef {
  type: "raw_event";
  /** Raw log aggregation backed by HyperSync. */
  source: "hypersync";
  chainId: number;
  queries: RawEventQuery[];
  contractAddresses?: string[];
  field?: string;
  aggregation: "sum" | "count" | "avg" | "min" | "max";
  filters?: Filter[];
}

export interface StateRef {
  type: "state";
  protocol?: string;
  entity_type: string;
  filters: Filter[];
  field: string;
  /**
   * Snapshot timing:
   * - 'current': current block (default)
   * - 'window_start': start of signal's window
   * - Custom duration string (e.g., "2d", "7d"): state at N time ago
   */
  snapshot?: "current" | "window_start" | string;
}

export type RpcTypedArgType =
  | "address"
  | "bool"
  | "string"
  | "bytes"
  | `bytes${number}`
  | `uint${number}`
  | `int${number}`;

export type RpcTypedArgValue = string | bigint | boolean;

export interface RpcTypedArg {
  type: RpcTypedArgType;
  value: RpcTypedArgValue;
}

export interface GenericRpcCall {
  to: string;
  signature: string;
  args: RpcTypedArg[];
}

export type MathOp = "add" | "sub" | "mul" | "div";

export interface BinaryExpression {
  type: "expression";
  operator: MathOp;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface Constant {
  type: "constant";
  value: number;
}

export type ExpressionNode = EventRef | RawEventRef | StateRef | BinaryExpression | Constant;

export type ComparisonOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

export interface Condition {
  type: "condition";
  left: ExpressionNode;
  operator: ComparisonOp;
  right: ExpressionNode;
  /** Optional per-condition window override */
  window?: string;
}

export interface SignalScope {
  chains: number[];
}

export interface Signal {
  id: string;
  name: string;
  description?: string;
  chains: number[];
  window: {
    duration: string;
  };
  conditions: Condition[];
  logic?: "AND" | "OR";
  webhook_url: string;
  cooldown_minutes: number;
  is_active: boolean;
  last_triggered_at?: string | Date;
  last_evaluated_at?: string | Date;
}

/** Result of evaluating a single condition */
export interface ConditionResult {
  conditionIndex: number;
  triggered: boolean;
  operator?: string;
  leftValue?: number;
  rightValue?: number;
}

export interface WebhookPayload {
  signal_id: string;
  signal_name: string;
  signal_description?: string;
  triggered_at: string;
  summary?: string;
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
