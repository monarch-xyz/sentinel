# Query System

> How Flare evaluates conditions against blockchain data.

## Expression Tree

All conditions are trees of `ExpressionNode`:

```
Condition = left(ExpressionNode) OPERATOR right(ExpressionNode)
```

## Node Types

### Constant
```json
{ "type": "constant", "value": 1000000 }
```

### State (current or historical)
```json
{
  "type": "state",
  "entity_type": "Position",
  "filters": [{ "field": "user", "op": "eq", "value": "0x..." }],
  "field": "supply_assets",
  "snapshot": "current"
}
```
**Snapshot options:** `current`, `window_start`, `2d`, `7d`, etc.

### Event (aggregated over window)
```json
{
  "type": "event",
  "event_type": "Supply",
  "filters": [{ "field": "market_id", "op": "eq", "value": "0x..." }],
  "field": "assets",
  "aggregation": "sum",
  "window": "24h"
}
```
**Aggregations:** `sum`, `count`, `avg`, `min`, `max`

### Expression (math)
```json
{
  "type": "expression",
  "operator": "div",
  "left": { ... },
  "right": { ... }
}
```
**Operators:** `add`, `sub`, `mul`, `div`

## Comparison Operators

`gt`, `gte`, `lt`, `lte`, `eq`, `neq`

## Filter Operators

`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`

## Data Entities

| Entity | Fields |
|--------|--------|
| `Position` | `user`, `marketId`, `supplyShares`, `borrowShares`, `collateral` |
| `Market` | `totalSupplyAssets`, `totalBorrowAssets`, `fee`, `lltv` |

**Events:** `Supply`, `Withdraw`, `Borrow`, `Repay`, `Liquidate`

## Examples

### Position dropped 30% in 7d
```json
{
  "left": {
    "type": "expression",
    "operator": "div",
    "left": { "type": "state", "entity_type": "Position", "field": "supply_assets", "snapshot": "current", "filters": [{"field": "user", "op": "eq", "value": "0x..."}] },
    "right": { "type": "state", "entity_type": "Position", "field": "supply_assets", "snapshot": "7d", "filters": [{"field": "user", "op": "eq", "value": "0x..."}] }
  },
  "operator": "lt",
  "right": { "type": "constant", "value": 0.70 }
}
```

### Supply volume > 1M in 24h
```json
{
  "left": { "type": "event", "event_type": "Supply", "field": "assets", "aggregation": "sum", "window": "24h", "filters": [] },
  "operator": "gt",
  "right": { "type": "constant", "value": 1000000 }
}
```

### Utilization > 90%
```json
{
  "left": {
    "type": "expression",
    "operator": "div",
    "left": { "type": "state", "entity_type": "Market", "field": "totalBorrowAssets", "filters": [{"field": "id", "op": "eq", "value": "0x..."}] },
    "right": { "type": "state", "entity_type": "Market", "field": "totalSupplyAssets", "filters": [{"field": "id", "op": "eq", "value": "0x..."}] }
  },
  "operator": "gt",
  "right": { "type": "constant", "value": 0.9 }
}
```

## Evaluation Flow

```
Signal → Window (duration) → Block Resolution → Envio Query → Evaluate Tree → Boolean
```

Time-travel queries resolve timestamps to block numbers via binary search.
