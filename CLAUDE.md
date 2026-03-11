# CLAUDE.md - Sentinel Project Context

Context for AI coding agents working on Sentinel.

## Project Summary

Sentinel is a signal monitoring service for Monarch. It stores user-scoped signals, evaluates them on a worker, and dispatches webhooks when conditions trigger.

The system supports multi-condition and multi-address logic, with Telegram delivery handled by a separate adapter service.

## Project Status

The project is under active development. Use the repository docs for the current external contract instead of relying on historical notes in this file.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ / TypeScript |
| API | Express.js |
| Database | PostgreSQL |
| Data Source | Envio GraphQL + RPC |
| Scheduling | BullMQ worker + scheduler |
| Validation | Zod |

## Key Files

| File | Purpose |
|------|---------|
| `docs/README.md` | Documentation map |
| `docs/DSL.md` | Signal definition reference |
| `docs/ARCHITECTURE.md` | Runtime architecture |
| `docs/DESIGN_DECISIONS.md` | Technical decisions |
| `docs/API.md` | HTTP API reference |
| `docs/GETTING_STARTED.md` | Local setup guide |
| `docs/DEPLOYMENT.md` | Deployment guide |

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

- scope: chains, markets, and addresses to watch
- conditions: the checks that determine whether the signal triggers
- window: the evaluation time frame
- webhook target: where notifications are sent

### Condition Types

1. Threshold
2. Change
3. Group
4. Aggregate

### Metric Families

- position metrics
- market metrics
- event metrics
- flow metrics

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

## Planning Reference

For current implementation status, use [TODO.md](./TODO.md).

For roadmap-level priorities, use [docs/ROADMAP.md](./docs/ROADMAP.md).

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
// Use GraphQL for indexed state and event queries
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
// Dispatch webhooks with retries and timeout controls
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

### Run Locally
```bash
pnpm docker:up
```

## Primary References

- [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)
- [docs/API.md](./docs/API.md)
- [docs/DSL.md](./docs/DSL.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
