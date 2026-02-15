# CLAUDE.md - Sentinel Project Context

> Context file for AI coding agents working on Sentinel.

## What is Sentinel?

Sentinel is a **signal monitoring service** for Monarch (DeFi dashboard for Morpho Blue). It lets users define complex conditions on blockchain data and receive webhook notifications when conditions trigger.

**Key differentiator:** Supports multi-condition, multi-address logic — not just simple thresholds.

## Project Status

🚧 **Design Phase** — Project is scaffolded, implementation starting.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ / TypeScript |
| API | Express.js |
| Database | PostgreSQL |
| Data Source | Envio GraphQL (existing indexer) |
| Scheduling | node-cron |
| Validation | Zod |

## Key Files

| File | Purpose |
|------|---------|
| `docs/ARCHITECTURE.md` | Full architecture & DSL reference |
| `docs/DESIGN_DECISIONS.md` | Technical decisions |
| `docs/API.md` | REST API documentation |
| `docs/GETTING_STARTED.md` | Developer setup guide |

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    FLARE                        │
├─────────────────────────────────────────────────┤
│  API           │  Engine       │  Worker       │
│  (CRUD +       │  (Condition   │  (Scheduler + │
│   Simulate)    │   Evaluation) │   Notify)     │
└────────────────┴───────────────┴───────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  Envio Indexer  │
              │  (7 chains)     │
              └─────────────────┘
```

## Core Concepts

### Signal
User-defined monitoring rule with:
- **Scope**: chains, markets, addresses to watch
- **Conditions**: what triggers the signal
- **Window**: time frame (e.g., "1h", "7d")
- **Webhook**: where to send notifications

### Condition Types
1. **Threshold** — value > X
2. **Change** — value changed by X%
3. **Group** — N of M addresses meet condition
4. **Aggregate** — sum/avg across scope

### Metrics
- Position: `Morpho.Position.supplyShares`, `Morpho.Position.borrowShares`, `Morpho.Position.collateral`
- Market: `Morpho.Market.totalSupplyAssets`, `Morpho.Market.utilization`
- Flow: `Morpho.Flow.netSupply`, `Morpho.Flow.totalLiquidations`

## Data Sources

**Envio Indexer** (`monarch-xyz/envio-indexer`):
- GraphQL endpoint with Position, Market, Event entities
- 7 chains: Ethereum, Base, Polygon, Arbitrum, Unichain, HyperEVM, Monad
- Use for indexed current state and events

**RPC (per chain):**
- Point-in-time state reads (eth_call at block)

**Envio Schema entities:**
- `Position` — user positions per market
- `Market` — market state (totalSupply, totalBorrow, etc.)
- `Morpho_Supply`, `Morpho_Withdraw`, etc. — raw events

## Implementation Priorities

### Phase 1 (Current)
- [ ] Project scaffold (package.json, tsconfig, etc.)
- [ ] Database schema + migrations
- [ ] Signal CRUD API
- [ ] Basic conditions (threshold, change)
- [ ] Single-market evaluation
- [ ] Webhook dispatch

### Phase 2
- [ ] Group conditions (N of M)
- [ ] Aggregate conditions
- [ ] Multi-market scope
- [ ] Flow metrics

### Phase 3
- [ ] Simulation endpoint
- [ ] Historical data fetching

## Code Patterns

### Condition Evaluation
```typescript
// Each condition type has an evaluator
async function evaluateThreshold(
  condition: ThresholdCondition,
  context: EvaluationContext
): Promise<EvaluationResult> {
  const value = await fetchMetric(condition.metric, context);
  return {
    triggered: compareValue(value, condition.operator, condition.value),
    value,
  };
}
```

### Envio Queries
```typescript
// Use GraphQL for all data fetching
const POSITIONS_QUERY = gql`
  query GetPositions($chainId: Int!, $marketId: String!, $users: [String!]!) {
    Position(where: { chainId: { _eq: $chainId }, ... }) {
      user
      supplyShares
      borrowShares
    }
  }
`;
```

### Webhook Dispatch
```typescript
// Always retry with backoff
await dispatchWebhook(url, payload, {
  retries: 3,
  backoff: 'exponential',
  timeout: 10000,
});
```

## Related Projects

| Project | Path | Relationship |
|---------|------|--------------|
| envio-indexer | `/Users/anton/clawd/envio-indexer` | Data source |
| data-api | `/Users/anton/clawd/data-api` | Similar patterns |
| monarch FE | `/Users/anton/clawd/monarch` | Consumer |
| telltide | `monarch-xyz/telltide` | Predecessor (SQD-based) |

## Testing Guidelines

- Unit test all condition evaluators
- Integration test API endpoints
- Mock Envio responses in tests
- Test webhook retry logic

## Common Tasks

### Add new condition type
1. Create `src/engine/conditions/{type}.ts`
2. Add types to `src/types/condition.ts`
3. Register in evaluator switch
4. Update DSL.md
5. Add tests

### Add new metric
1. Add fetcher to `src/engine/metrics/`
2. Add to MetricType union
3. Update DSL.md

### Run locally
```bash
docker compose up -d    # Start PostgreSQL
pnpm db:migrate         # Run migrations
pnpm dev                # Start all services
```

## Questions?

Check the docs in `docs/` or ask in the Monarch Discord.
