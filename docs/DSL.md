# DSL Reference

This is the canonical reference for Sentinel signal definitions. Signal shape, condition types, metrics, and example signals should live here instead of being duplicated in setup or API docs.

## Definition Shape

```json
{
  "scope": {
    "chains": [1],
    "markets": ["0x..."],
    "addresses": ["0x..."],
    "protocol": "morpho"
  },
  "window": { "duration": "1h" },
  "logic": "AND",
  "conditions": [
    {
      "type": "threshold",
      "metric": "Morpho.Market.utilization",
      "operator": ">",
      "value": 0.9,
      "chain_id": 1,
      "market_id": "0x..."
    }
  ]
}
```

At the HTTP layer, this object is sent as the `definition` field inside `POST /api/v1/signals`. The surrounding request wrapper is documented in [API.md](./API.md).

## Scope

```json
{
  "scope": {
    "chains": [1],
    "markets": ["0xmarket"],
    "addresses": ["0xaddress"],
    "protocol": "morpho"
  }
}
```

Rules:

- `chains` is required
- `markets` and `addresses` are optional
- `protocol` is optional and currently supports `morpho` and `all`
- if a condition omits `chain_id`, `market_id`, or `address`, the compiler may infer it from scope when there is only one unambiguous value
- if scope contains multiple values, set the specific field in the condition to avoid ambiguity

## Window

```json
{ "window": { "duration": "1h" } }
```

Rules:

- duration format is `{number}{unit}`
- supported units: `s`, `m`, `h`, `d`, `w`
- examples: `30m`, `1h`, `7d`, `3600s`
- the public DSL window is duration-based only
- a condition may override the signal-level window with its own `window`

## Condition Types

### Threshold

Compare a metric to a fixed value.

```json
{
  "type": "threshold",
  "metric": "Morpho.Market.utilization",
  "operator": ">",
  "value": 0.9,
  "chain_id": 1,
  "market_id": "0x..."
}
```

### Change

Compare a current value to a historical value.

```json
{
  "type": "change",
  "metric": "Morpho.Position.supplyShares",
  "direction": "decrease",
  "by": { "percent": 20 },
  "chain_id": 1,
  "market_id": "0x...",
  "address": "0x..."
}
```

Rules:

- `direction` should be `increase` or `decrease`
- `by` accepts either `{ "percent": number }` or `{ "absolute": number }`

### Group

Evaluate one or more conditions per address, then apply an N-of-M requirement.

```json
{
  "type": "group",
  "addresses": ["0xA", "0xB", "0xC"],
  "requirement": { "count": 2, "of": 3 },
  "logic": "AND",
  "conditions": [
    {
      "type": "threshold",
      "metric": "Morpho.Position.collateral",
      "operator": "<",
      "value": 100,
      "chain_id": 1,
      "market_id": "0x..."
    }
  ]
}
```

Rules:

- `requirement.of` must equal the number of `addresses`
- inner conditions should not set `address`; Sentinel injects it per address
- use `logic` when each address must satisfy multiple inner conditions together

### Aggregate

Aggregate a metric across the current scope.

```json
{
  "type": "aggregate",
  "aggregation": "sum",
  "metric": "Morpho.Event.Supply.assets",
  "operator": ">",
  "value": 1000000,
  "chain_id": 1,
  "market_id": "0x..."
}
```

Rules:

- `aggregation` supports `sum`, `avg`, `min`, `max`, `count`
- market aggregates need market scope
- position aggregates need both market and address scope

## Metrics

The canonical registry lives in `src/engine/metrics.ts`.

Common state metrics:

- `Morpho.Position.supplyShares`
- `Morpho.Position.borrowShares`
- `Morpho.Position.collateral`
- `Morpho.Market.totalSupplyAssets`
- `Morpho.Market.totalBorrowAssets`
- `Morpho.Market.fee`

Computed metrics:

- `Morpho.Market.utilization`

Event metrics:

- `Morpho.Event.Supply.assets`
- `Morpho.Event.Supply.count`
- `Morpho.Event.Withdraw.assets`
- `Morpho.Event.Borrow.assets`
- `Morpho.Event.Repay.assets`
- `Morpho.Event.Liquidate.repaidAssets`

Flow metrics:

- `Morpho.Flow.netSupply`
- `Morpho.Flow.netBorrow`
- `Morpho.Flow.totalLiquidations`

## Event Filters

Event-based `threshold` and `aggregate` conditions can add `filters`:

```json
{
  "type": "threshold",
  "metric": "Morpho.Event.Supply.assets",
  "operator": ">",
  "value": 1000,
  "chain_id": 1,
  "market_id": "0xM",
  "filters": [
    { "field": "caller", "op": "eq", "value": "0xC" },
    { "field": "isMonarch", "op": "eq", "value": true }
  ]
}
```

Filters are for event metrics only.

## Canonical Examples

### Simple Market Threshold

```json
{
  "scope": { "chains": [1], "markets": ["0xM"] },
  "window": { "duration": "1h" },
  "conditions": [
    {
      "type": "threshold",
      "metric": "Morpho.Market.utilization",
      "operator": ">",
      "value": 0.9,
      "chain_id": 1,
      "market_id": "0xM"
    }
  ]
}
```

### Position Drop Over Time

```json
{
  "scope": {
    "chains": [1],
    "markets": ["0xM"],
    "addresses": ["0xA"]
  },
  "window": { "duration": "24h" },
  "conditions": [
    {
      "type": "change",
      "metric": "Morpho.Position.supplyShares",
      "direction": "decrease",
      "by": { "percent": 20 },
      "chain_id": 1,
      "market_id": "0xM",
      "address": "0xA"
    }
  ]
}
```

### Group Alert Across Addresses

```json
{
  "scope": { "chains": [1], "markets": ["0xM"] },
  "window": { "duration": "6h" },
  "conditions": [
    {
      "type": "group",
      "addresses": ["0xA", "0xB", "0xC"],
      "requirement": { "count": 2, "of": 3 },
      "logic": "AND",
      "conditions": [
        {
          "type": "threshold",
          "metric": "Morpho.Position.collateral",
          "operator": "<",
          "value": 100,
          "chain_id": 1,
          "market_id": "0xM"
        }
      ]
    }
  ]
}
```

### Aggregate Event Burst

```json
{
  "scope": { "chains": [1], "markets": ["0xM"] },
  "window": { "duration": "6h" },
  "logic": "AND",
  "conditions": [
    {
      "type": "aggregate",
      "aggregation": "sum",
      "metric": "Morpho.Event.Supply.count",
      "operator": ">",
      "value": 25,
      "chain_id": 1,
      "market_id": "0xM"
    },
    {
      "type": "aggregate",
      "aggregation": "sum",
      "metric": "Morpho.Event.Supply.assets",
      "operator": ">",
      "value": 1000000,
      "chain_id": 1,
      "market_id": "0xM"
    }
  ]
}
```

## Related Docs

- API payloads and routes: [API.md](./API.md)
- Local setup: [GETTING_STARTED.md](./GETTING_STARTED.md)
- Telegram delivery contract: [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md)
- Internal runtime design: [ARCHITECTURE.md](./ARCHITECTURE.md)
