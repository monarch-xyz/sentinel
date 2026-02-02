# 🔥 Flare

> **Composable Signal Monitoring for DeFi — by Monarch**

Flare enables sophisticated, multi-condition monitoring of blockchain data. It's designed to be protocol-agnostic, efficient, and highly extensible.

## 🚀 API Usage

Flare exposes a REST API for managing signals. All requests require an `X-API-Key`.

### Create a Signal
`POST /api/v1/signals`

```json
{
  "name": "Whale Position Drop",
  "chains": [1],
  "window": { "duration": "7d" },
  "condition": {
    "type": "condition",
    "operator": "lt",
    "left": {
      "type": "event",
      "event_type": "Withdraw",
      "filters": [{"field": "user", "op": "eq", "value": "0xwhale..."}],
      "field": "assets",
      "aggregation": "sum"
    },
    "right": { "type": "constant", "value": 1000000000000 }
  },
  "webhook_url": "https://your-webhook.com/alerts"
}
```

## 🧩 Defining the DSL

Flare uses a tree-based DSL composed of four primitives:

1. **EventRef**: Aggregates events over the time window.
   - `Supply`, `Withdraw`, `Borrow`, etc.
2. **StateRef**: Reads entity state at `current` or `window_start`.
   - `Position.supply_assets`, `Market.total_supply`, etc.
3. **Expression**: Composable math operations (`add`, `sub`, `mul`, `div`).
   - Example: `Supply.assets - Withdraw.assets`
4. **Condition**: Compares two expressions using operators (`gt`, `lt`, `eq`, etc.).

## 🏗️ Architecture

- **Data Source**: Envio GraphQL (Supports time-travel queries via block height).
- **Execution**: Recursive tree-walker for expression evaluation.
- **Scaling**: BullMQ-based job distribution for workers.
- **Notifications**: Pure Webhook architecture. Telegram/Discord are handled via external tunnels.

## 🛠️ Development

See [GETTING_STARTED.md](./docs/GETTING_STARTED.md) for local setup and [DESIGN.md](./docs/DESIGN.md) for full technical RFC.
