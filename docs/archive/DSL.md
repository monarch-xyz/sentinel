# Flare Signal DSL Reference

> Complete reference for defining signals in Flare.

## Overview

Signals are defined using a JSON-based Domain Specific Language (DSL). Each signal consists of:
- **Scope** — what chains/markets/addresses to monitor
- **Conditions** — what triggers the signal
- **Window** — time frame for evaluation
- **Delivery** — how to send notifications

## Signal Structure

```typescript
interface Signal {
  // Identity
  id?: string;                   // Auto-generated UUID
  name: string;                  // Human-readable name
  description?: string;          // Optional description
  
  // Definition
  definition: {
    scope: Scope;
    conditions: Condition[];
    logic?: 'AND' | 'OR';        // Default: AND
    window: TimeWindow;
  };
  
  // Delivery
  webhook_url: string;
  cooldown_minutes?: number;     // Default: 5
  
  // State (read-only)
  is_active?: boolean;
  created_at?: string;
  last_triggered_at?: string;
}
```

---

## Scope

Defines what data the signal monitors.

```typescript
interface Scope {
  chains: number[];              // Chain IDs: [1, 8453, 137, ...]
  markets?: string[];            // Morpho market IDs (optional)
  addresses?: string[];          // Addresses to track (optional)
  protocol?: 'morpho' | 'all';   // Default: 'morpho'
}
```

### Examples

**All markets on Ethereum:**
```json
{ "chains": [1] }
```

**Specific markets on multiple chains:**
```json
{
  "chains": [1, 8453],
  "markets": ["0x58e212...", "0xabc123..."]
}
```

**Track specific addresses:**
```json
{
  "chains": [1],
  "markets": ["0x58e212..."],
  "addresses": ["0xwhale1...", "0xwhale2..."]
}
```

---

## Time Window

Defines the evaluation time frame.

```typescript
interface TimeWindow {
  duration: string;              // "15m", "1h", "24h", "7d"
  lookback_blocks?: number;      // Optional: use blocks instead
}
```

### Duration Formats

| Format | Meaning |
|--------|---------|
| `15m` | 15 minutes |
| `1h` | 1 hour |
| `24h` | 24 hours |
| `7d` | 7 days |
| `30d` | 30 days |

### Block-based Lookback

For more precise/efficient queries, use `lookback_blocks`:

```json
{
  "duration": "1h",
  "lookback_blocks": 300
}
```

---

## Conditions

### Condition Types

| Type | Description | Use Case |
|------|-------------|----------|
| `threshold` | Compare value to threshold | "TVL > $1M" |
| `change` | Detect value changes | "Position dropped 10%" |
| `group` | N-of-M address logic | "3 of 5 whales exit" |
| `aggregate` | Cross-entity aggregation | "Total supply across markets" |

---

### Threshold Condition

Simple value comparison.

```typescript
interface ThresholdCondition {
  type: 'threshold';
  metric: MetricType;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
  
  // Optional filters
  market_id?: string;
  address?: string;
}
```

**Example: Alert when utilization exceeds 95%**
```json
{
  "type": "threshold",
  "metric": "market_utilization",
  "operator": ">",
  "value": 0.95
}
```

**Example: Alert when specific address has > $1M supply**
```json
{
  "type": "threshold",
  "metric": "supply_assets",
  "operator": ">",
  "value": 1000000000000,
  "address": "0xwhale..."
}
```

---

### Change Condition

Detect changes over the time window.

```typescript
interface ChangeCondition {
  type: 'change';
  metric: MetricType;
  direction: 'increase' | 'decrease' | 'any';
  by: { percent: number } | { absolute: number };
  
  // Optional filters
  market_id?: string;
  address?: string;
}
```

**Example: Alert when position decreases by 10%**
```json
{
  "type": "change",
  "metric": "supply_assets",
  "direction": "decrease",
  "by": { "percent": 10 }
}
```

**Example: Alert when TVL drops by $500k**
```json
{
  "type": "change",
  "metric": "market_total_supply",
  "direction": "decrease",
  "by": { "absolute": 500000000000 }
}
```

---

### Group Condition

N-of-M logic for tracking multiple addresses.

```typescript
interface GroupCondition {
  type: 'group';
  addresses: string[];
  requirement: {
    count: number;               // At least N
    of: number;                  // of M total
  };
  condition: Condition;          // Each must meet this
}
```

**Example: 3 of 5 whales reduce position by 10%**
```json
{
  "type": "group",
  "addresses": [
    "0xwhale1...",
    "0xwhale2...",
    "0xwhale3...",
    "0xwhale4...",
    "0xwhale5..."
  ],
  "requirement": { "count": 3, "of": 5 },
  "condition": {
    "type": "change",
    "metric": "supply_assets",
    "direction": "decrease",
    "by": { "percent": 10 }
  }
}
```

---

### Aggregate Condition

Aggregate values across scope.

```typescript
interface AggregateCondition {
  type: 'aggregate';
  aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count';
  metric: MetricType;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
}
```

**Example: Total supply across all watched markets > $10M**
```json
{
  "type": "aggregate",
  "aggregation": "sum",
  "metric": "market_total_supply",
  "operator": ">",
  "value": 10000000000000
}
```

**Example: Average utilization across markets > 80%**
```json
{
  "type": "aggregate",
  "aggregation": "avg",
  "metric": "market_utilization",
  "operator": ">",
  "value": 0.8
}
```

---

## Metrics

### Position Metrics (per address per market)

| Metric | Description | Unit |
|--------|-------------|------|
| `supply_assets` | Supply position in assets | wei |
| `supply_shares` | Supply position in shares | wei |
| `borrow_assets` | Borrow position in assets | wei |
| `borrow_shares` | Borrow position in shares | wei |
| `collateral_assets` | Collateral amount | wei |

### Market Metrics (aggregate)

| Metric | Description | Unit |
|--------|-------------|------|
| `market_total_supply` | Total supply in market | wei |
| `market_total_borrow` | Total borrows in market | wei |
| `market_utilization` | Borrow/Supply ratio | 0-1 |
| `market_borrow_rate` | Current borrow APY | 0-1 |

### Flow Metrics (event-based)

| Metric | Description | Unit |
|--------|-------------|------|
| `net_supply_flow` | supply - withdraw over window | wei |
| `net_borrow_flow` | borrow - repay over window | wei |
| `liquidation_volume` | Total liquidations | wei |
| `event_count` | Number of events | count |

---

## Combining Conditions

### AND Logic (default)

All conditions must be true:

```json
{
  "logic": "AND",
  "conditions": [
    { "type": "threshold", "metric": "market_utilization", "operator": ">", "value": 0.9 },
    { "type": "change", "metric": "market_total_supply", "direction": "decrease", "by": { "percent": 10 } }
  ]
}
```

### OR Logic

Any condition triggers:

```json
{
  "logic": "OR",
  "conditions": [
    { "type": "threshold", "metric": "market_utilization", "operator": ">", "value": 0.95 },
    { "type": "aggregate", "aggregation": "sum", "metric": "liquidation_volume", "operator": ">", "value": 1000000000000 }
  ]
}
```

---

## Complete Examples

### Example 1: Liquidity Crisis Alert

```json
{
  "name": "Liquidity Crisis Alert",
  "definition": {
    "scope": {
      "chains": [1],
      "markets": ["0x58e212..."]
    },
    "window": { "duration": "1h" },
    "logic": "AND",
    "conditions": [
      {
        "type": "change",
        "metric": "market_total_supply",
        "direction": "decrease",
        "by": { "percent": 20 }
      },
      {
        "type": "threshold",
        "metric": "market_utilization",
        "operator": ">",
        "value": 0.95
      }
    ]
  },
  "webhook_url": "https://hooks.example.com/alert",
  "cooldown_minutes": 10
}
```

### Example 2: Whale Movement Tracker

```json
{
  "name": "Whale Exodus",
  "definition": {
    "scope": {
      "chains": [1, 8453],
      "markets": ["0xmarket1...", "0xmarket2..."]
    },
    "window": { "duration": "7d" },
    "conditions": [
      {
        "type": "group",
        "addresses": ["0xw1", "0xw2", "0xw3", "0xw4", "0xw5"],
        "requirement": { "count": 3, "of": 5 },
        "condition": {
          "type": "change",
          "metric": "supply_assets",
          "direction": "decrease",
          "by": { "percent": 10 }
        }
      }
    ]
  },
  "webhook_url": "https://hooks.example.com/whales",
  "cooldown_minutes": 60
}
```

### Example 3: Net Flow Alert

```json
{
  "name": "Large Net Withdrawal",
  "definition": {
    "scope": {
      "chains": [1]
    },
    "window": { "duration": "2h" },
    "conditions": [
      {
        "type": "aggregate",
        "aggregation": "sum",
        "metric": "net_supply_flow",
        "operator": "<",
        "value": -1000000000000
      }
    ]
  },
  "webhook_url": "https://hooks.example.com/flows",
  "cooldown_minutes": 30
}
```

---

## Validation Rules

1. **Scope must have at least one chain**
2. **Window duration must be valid format** (e.g., "1h", "7d")
3. **Conditions array must not be empty**
4. **Group condition addresses must match requirement.of**
5. **Metric must be valid for condition type**
6. **Webhook URL must be valid HTTPS URL**

---

## Future Extensions

- **Expression strings**: `"supply_assets > 1000000 AND utilization > 0.9"`
- **Nested conditions**: AND/OR trees
- **Time-based triggers**: "At 9am daily"
- **Multi-protocol support**: Aave, Compound, etc.
