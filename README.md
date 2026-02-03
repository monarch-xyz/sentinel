# 🔥 Flare

> **Composable Signal Monitoring for DeFi — by Monarch**

Flare enables sophisticated, multi-condition monitoring of blockchain data. Users define signals using a friendly DSL, and Flare handles the evaluation, time-travel queries, and webhook delivery.

## Quick Example

"Alert when a whale's position drops 20% over 7 days":

```json
{
  "name": "Whale Position Drop",
  "chains": [1],
  "window": { "duration": "7d" },
  "conditions": [{
    "type": "change",
    "metric": "Morpho.Position.supplyShares",
    "direction": "decrease",
    "by": { "percent": 20 },
    "address": "0xwhale..."
  }],
  "webhook_url": "https://your-webhook.com/alerts"
}
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [**ARCHITECTURE.md**](./docs/ARCHITECTURE.md) | DSL reference, metrics, evaluation flow, supported chains |
| [**API.md**](./docs/API.md) | REST API endpoints |
| [**GETTING_STARTED.md**](./docs/GETTING_STARTED.md) | Local setup |
| [**DESIGN_DECISIONS.md**](./docs/DESIGN_DECISIONS.md) | Technical decisions |

## Key Concepts

### Metrics (Extensible)
```
Morpho.Position.supplyShares    # User positions
Morpho.Market.totalSupplyAssets # Market aggregates
Morpho.Market.utilization       # Computed metrics
Morpho.Event.Supply.assets      # Event aggregations
```

### Condition Types
- **Threshold** — value > X
- **Change** — value changed by X%
- **Group** — N of M addresses meet condition
- **Aggregate** — sum/avg across scope

### Architecture
```
User DSL → Compiler → Expression Tree → Evaluator → Envio → Result → Webhook
```

## Development

```bash
pnpm install
docker compose up -d    # PostgreSQL + Redis
pnpm db:migrate
pnpm dev               # Start all services
pnpm test              # Run tests
```

## Status

See [TODO.md](./TODO.md) for implementation progress.
