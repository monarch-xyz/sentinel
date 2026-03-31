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

## Reference Families

Sentinel supports three canonical reference families in the DSL:

| Family | How you reference it in DSL | Typical examples | Backing source today |
| --- | --- | --- | --- |
| state | `metric` on `threshold`, `change`, or `aggregate` | `Morpho.Position.supplyShares`, `Morpho.Market.totalBorrowAssets` | RPC |
| indexed | `metric` on `threshold` or `aggregate` (advanced) | `Morpho.Event.Supply.assets`, `Morpho.Flow.netSupply` | indexing boundary, currently Envio |
| raw | `type: "raw-events"` with `event`, optional `filters`, and `field` for non-`count` aggregations (default event primitive) | ERC-20/ERC-721/ERC-1155 transfers and approvals, raw swap logs, custom ABI events | indexing boundary, currently HyperSync |

These are the only three top-level families users need to think about.

Provider choice is an implementation detail:

- RPC powers current and historical state reads
- the indexing boundary powers indexed semantic history plus raw decoded event scans
- today the indexing boundary uses Envio for indexed reads and HyperSync for raw reads

Runtime gating:

- state stays enabled by default
- indexed requires `ENVIO_ENDPOINT`
- raw requires `ENVIO_API_TOKEN`
- if a required source family is disabled, Sentinel rejects that signal definition through the API instead of storing it and failing later

See [SOURCES.md](./SOURCES.md) for the full capability model and future extension path.

## How Families Compose

The public DSL is family-first, not provider-first.

- `metric` references compile into state or indexed AST refs
- `raw-events` compiles into raw-event AST refs
- the evaluator can combine those refs through normal expression and condition nodes

That is the path for future extension too:

- if a new provider serves an existing family, keep the DSL unchanged and update the planner
- if a genuinely new family is needed, add a new leaf ref type and keep provider details out of the DSL

## Condition Inputs

Each condition shape accepts one of two input styles:

| Condition type | Input style | Used for |
| --- | --- | --- |
| `threshold` | `metric` | compare one state or indexed metric to a fixed value |
| `change` | `metric` | compare current state to historical state |
| `aggregate` | `metric` | aggregate one state or indexed metric across the current scope |
| `raw-events` | `event` + optional `field` | scan raw decoded logs and aggregate matching rows; `field` is only required when `aggregation` is not `count` |

## Metric Families

The `metric` field is only for state and indexed references.

Use these naming patterns:

- `Morpho.Position.*` for position state
- `Morpho.Market.*` for market state and computed state
- `Morpho.Event.*` for indexed semantic event metrics
- `Morpho.Flow.*` for indexed derived event flows

Examples:

- state: `Morpho.Position.supplyShares`
- state: `Morpho.Market.totalBorrowAssets`
- computed state: `Morpho.Market.utilization`
- indexed event metric: `Morpho.Event.Supply.assets`
- indexed flow metric: `Morpho.Flow.netSupply`

Important:

- `Morpho.Event.*` and `Morpho.Flow.*` are indexed semantic references, not raw logs
- if you need raw decoded logs, use `type: "raw-events"` instead of `metric`

## Condition Types

### Threshold

Compare a metric to a fixed value.

Works with:

- state metrics
- indexed event metrics
- indexed flow metrics
- computed state metrics

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

Works with:

- state metrics

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

Works with:

- state metrics
- computed state metrics
- indexed event metrics
- indexed flow metrics

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

### Raw Events

Scan raw logs with HyperSync, decode them with an ABI event signature or preset, filter them, then aggregate the matching rows.

```json
{
  "type": "raw-events",
  "aggregation": "sum",
  "field": "value",
  "operator": ">",
  "value": 1000000,
  "chain_id": 1,
  "window": { "duration": "1h" },
  "event": {
    "kind": "erc20_transfer",
    "contract_addresses": ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]
  },
  "filters": [{ "field": "from", "op": "eq", "value": "0xC..." }]
}
```

Count-only example:

```json
{
  "type": "raw-events",
  "aggregation": "count",
  "operator": ">",
  "value": 25,
  "chain_id": 1,
  "event": {
    "kind": "erc20_transfer",
    "contract_addresses": ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]
  },
  "filters": [{ "field": "to", "op": "eq", "value": "0xReceiver" }]
}
```

Generic contract event example:

```json
{
  "type": "raw-events",
  "aggregation": "sum",
  "field": "amount0In",
  "operator": ">",
  "value": 500000,
  "chain_id": 1,
  "window": { "duration": "30m" },
  "event": {
    "kind": "contract_event",
    "contract_addresses": ["0xPool"],
    "signature": "Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
  }
}
```

Normalized swap preset example:

```json
{
  "type": "raw-events",
  "aggregation": "sum",
  "field": "amount0_abs",
  "operator": ">",
  "value": 500000,
  "chain_id": 1,
  "window": { "duration": "30m" },
  "event": {
    "kind": "swap",
    "protocols": ["uniswap_v2", "uniswap_v3"],
    "contract_addresses": ["0xPoolA", "0xPoolB"]
  },
  "filters": [{ "field": "recipient", "op": "eq", "value": "0xRecipient" }]
}
```

Rules:

- `aggregation` supports `sum`, `avg`, `min`, `max`, `count`
- `field` is required for `sum`, `avg`, `min`, and `max`
- `field` may be omitted when `aggregation` is `count`
- well-known `event.kind` values currently include: `erc20_transfer`, `erc20_approval`, `erc721_transfer`, `erc721_approval`, `erc721_approval_for_all`, `erc1155_transfer_single`, `erc1155_transfer_batch`, and `swap`
- `event.kind = "erc20_transfer"` uses the canonical ERC-20 `Transfer` signature
- `event.kind = "swap"` expands into all requested supported swap presets; if `protocols` is omitted, Sentinel currently queries both `uniswap_v2` and `uniswap_v3`
- `event.kind = "contract_event"` requires a full ABI event signature, including `indexed` markers
- `signature` is only valid with `event.kind = "contract_event"`
- `protocols` is only valid with `event.kind = "swap"`
- `filters` run against decoded event arguments and metadata fields such as `contract_address`, `block_number`, and `transaction_hash`
- `swap` presets also add normalized fields: `recipient`, `amount0_in`, `amount0_out`, `amount0_abs`, `amount1_in`, `amount1_out`, `amount1_abs`, and `swap_protocol`
- `contract_addresses` is optional, but omitting it can create very broad scans

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

Indexed event metrics:

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

They do not apply to `raw-events`. Raw-event filters are decoded in-memory after HyperSync returns raw logs.

## Compile-Tested Canonical Examples

Everything in this section is intended to work now and is covered by compile-level tests in `src/engine/compile-signal.test.ts`.

### State: Simple Market Threshold

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

### State: Position Drop Over Time

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

### State: Group Alert Across Addresses

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

### Raw: ERC-20 Transfer Volume

```json
{
  "scope": { "chains": [1], "protocol": "all" },
  "window": { "duration": "1h" },
  "conditions": [
    {
      "type": "raw-events",
      "aggregation": "sum",
      "field": "value",
      "operator": ">",
      "value": 1000000,
      "event": {
        "kind": "erc20_transfer",
        "contract_addresses": ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]
      },
      "filters": [{ "field": "to", "op": "eq", "value": "0xReceiver" }]
    }
  ]
}
```

### Raw: ERC-20 Transfer Count

```json
{
  "scope": { "chains": [1], "protocol": "all" },
  "window": { "duration": "1h" },
  "conditions": [
    {
      "type": "raw-events",
      "aggregation": "count",
      "operator": ">",
      "value": 25,
      "event": {
        "kind": "erc20_transfer",
        "contract_addresses": ["0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]
      },
      "filters": [{ "field": "to", "op": "eq", "value": "0xReceiver" }]
    }
  ]
}
```

### Indexed: Aggregate Event Burst

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

### Raw: Swap Volume Across Supported Presets

```json
{
  "scope": { "chains": [1], "protocol": "all" },
  "window": { "duration": "30m" },
  "conditions": [
    {
      "type": "raw-events",
      "aggregation": "sum",
      "field": "amount0_abs",
      "operator": ">",
      "value": 500000,
      "event": {
        "kind": "swap",
        "protocols": ["uniswap_v2", "uniswap_v3"],
        "contract_addresses": ["0xPoolA", "0xPoolB"]
      },
      "filters": [{ "field": "recipient", "op": "eq", "value": "0xRecipient" }]
    }
  ]
}
```

### Raw: Custom Contract Event

```json
{
  "scope": { "chains": [1], "protocol": "all" },
  "window": { "duration": "30m" },
  "conditions": [
    {
      "type": "raw-events",
      "aggregation": "sum",
      "field": "amount0In",
      "operator": ">",
      "value": 500000,
      "event": {
        "kind": "contract_event",
        "contract_addresses": ["0xPool"],
        "signature": "Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
      }
    }
  ]
}
```

## Related Docs

- API payloads and routes: [API.md](./API.md)
- Local setup: [GETTING_STARTED.md](./GETTING_STARTED.md)
- Telegram delivery contract: [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md)
- Internal runtime design: [ARCHITECTURE.md](./ARCHITECTURE.md)
