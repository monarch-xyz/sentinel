# Sentinel Architecture

This document owns the system design. Signal syntax lives in [DSL.md](./DSL.md); HTTP routes live in [API.md](./API.md).

## Overview

Sentinel has three main responsibilities:

1. accept and store user-scoped signals
2. evaluate them on a schedule
3. dispatch webhooks when conditions trigger

Telegram delivery is intentionally split into a separate service.

## Component Map

```text
user / backend
   |
   v
API (create, list, update signals)
   |
   v
PostgreSQL
   ^
   |
worker (scheduler + evaluator + webhook dispatch)
   |
   +--> Envio GraphQL for indexed state and events
   +--> RPC for point-in-time state
   |
   v
webhook target
   |
   v
optional delivery service (Telegram)
```

## Main Runtime Boundaries

### API

Owns:

- request validation
- auth middleware
- signal CRUD
- simulation endpoints

The API compiles signal definitions at write time before they are stored.

### Worker

Owns:

- polling active signals on a schedule
- evaluating compiled signal definitions
- writing evaluation history
- dispatching webhooks

### Delivery

Owns:

- Telegram bot polling
- link-token flow
- signature verification for incoming webhooks
- routing `app_user_id` to Telegram chat IDs

Delivery is optional. Sentinel itself is webhook-first.

## Data Sources

Sentinel uses a hybrid model:

| Query type | Source | Why |
| --- | --- | --- |
| current state | RPC | one consistent path for current and historical state |
| events over time | Envio | timestamped event history |
| historical state snapshot | RPC | precise point-in-time block reads |
| timestamp to block resolution | RPC | Envio does not support time-travel state reads |

The Envio time-travel limitation is documented separately in [ISSUE_NO_TIME_TRAVEL.md](./ISSUE_NO_TIME_TRAVEL.md).
Provider choice is intentionally kept behind the engine fetcher layer so the DSL and evaluator do not care whether a read comes from Envio, RPC, or a future source.

## Evaluation Flow

1. a client creates a signal through the API
2. the API validates and compiles the DSL
3. the compiled definition is stored in PostgreSQL
4. the worker scheduler picks up active signals
5. the worker resolves the needed data through Envio or RPC
6. the evaluator produces a triggered or non-triggered result
7. history is written to PostgreSQL
8. if triggered, Sentinel sends a webhook
9. optional delivery service verifies the webhook and sends a Telegram message

## Compilation Model

Sentinel stores a normalized internal form of the user DSL.

Conceptually:

- user DSL says: "position collateral decreased 20% over 7d"
- compiler rewrites that into: "current collateral < historical collateral * 0.8"
- evaluator then fetches current and historical values and compares them

That separation keeps the external DSL simple while keeping the evaluator generic.
The current runtime also keeps source planning separate from evaluation: compiled conditions produce state and event refs, and the fetcher decides which provider executes them.

## Metric Model

Metrics are registry-driven, not hardcoded per endpoint.

Current groups:

- state metrics, such as `Morpho.Position.collateral`
- computed metrics, such as `Morpho.Market.utilization`
- event metrics, such as `Morpho.Event.Supply.assets`
- chained event metrics, such as `Morpho.Flow.netSupply`

The user-facing metric rules are documented in [DSL.md](./DSL.md). The current registry lives in `src/engine/metrics.ts`.

## Operational Boundaries

- API and worker should run as separate processes in production
- Redis backs BullMQ job distribution
- PostgreSQL stores signals, API keys, history, and delivery mappings
- rate limiting for simulation is currently process-local

## Extension Points

To extend Sentinel:

- add metrics in `src/engine/metrics.ts`
- extend compiler logic in `src/engine/compile-signal.ts`
- add fetch paths in Envio or RPC clients
- add delivery channels as separate services behind the webhook boundary

## Related Docs

- [DSL.md](./DSL.md) for user-facing signal structure
- [API.md](./API.md) for HTTP routes
- [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md) for why the system looks this way
- [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md) for delivery-specific contracts
