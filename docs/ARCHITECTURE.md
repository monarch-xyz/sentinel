# Sentinel Architecture

This document owns the system design. Signal syntax lives in [DSL.md](./DSL.md); HTTP routes live in [API.md](./API.md).

## Overview

Sentinel has three main responsibilities:

1. accept and store user-scoped signals
2. evaluate them on a schedule
3. dispatch webhooks when conditions trigger

It now also owns its own control-plane auth:

- login identities
- browser sessions
- API keys
- authenticated integration status routes

Telegram delivery is still intentionally split into a separate service.

## Component Map

```text
user / API client
   |
   v
API control plane
  - auth identities
  - sessions
  - API keys
  - signal CRUD
  - integration status
   |
   v
PostgreSQL
   ^
   |
worker (scheduler + evaluator + webhook dispatch)
   |
   +--> source planner
         |
         +--> Envio GraphQL for event history
         +--> RPC for current and historical state
         +--> RPC block resolution for timestamp -> block
   |
   v
webhook target
   |
   v
optional delivery service (Telegram)
```

## Main Runtime Boundaries

### API Control Plane

Owns:

- request validation
- auth middleware
- login and session routes
- API-key issuance
- signal CRUD
- simulation endpoints
- authenticated integration status routes

The API compiles signal definitions at write time before they are stored.

### Worker Data Plane

Owns:

- polling active signals on a schedule
- evaluating compiled signal definitions
- writing evaluation history
- dispatching webhooks

The worker does not care whether a signal owner authenticated through SIWE, API keys, or a future provider. It only cares about the stored owner ID on the signal.

### Delivery

Owns:

- Telegram bot polling
- link-token flow
- signature verification for incoming webhooks
- routing `app_user_id` to Telegram chat IDs

Delivery is optional. Sentinel itself remains webhook-first.

## Canonical Owner Model

Today the canonical owner is `users.id`.

That same ID is used in:

- `signals.user_id`
- `api_keys.user_id`
- `user_sessions.user_id`
- `auth_identities.user_id`
- webhook `context.app_user_id`
- delivery `users.app_user_id`

This is why dual auth works cleanly: both session auth and API-key auth resolve to the same owner model.

## Evaluation Flow

1. a client creates a signal through the API
2. the API authenticates the caller to one Sentinel owner ID
3. the API validates and compiles the DSL
4. the compiled definition is stored in PostgreSQL
5. the worker scheduler picks up active signals
6. the worker resolves the needed data through the source planner
7. the planner routes state reads to RPC and event reads to Envio
8. the evaluator produces a triggered or non-triggered result
9. history is written to PostgreSQL
10. if triggered, Sentinel sends a webhook
11. optional delivery service verifies the webhook and sends a Telegram message

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

## Operational Boundaries

- API and worker should run as separate processes in production
- Redis backs BullMQ job distribution
- PostgreSQL stores signals, auth identities, sessions, API keys, and run history
- delivery keeps its own Telegram-specific database
- rate limiting for simulation is currently process-local

The core protection against auth churn affecting evaluations is process separation: login/session traffic hits the API control plane, while evaluation work happens in the worker.

## Extension Points

To extend Sentinel:

- add metrics in `src/engine/metrics.ts`
- extend compiler logic in `src/engine/compile-signal.ts`
- extend source planning in `src/engine/source-plan.ts`
- add provider-specific fetch paths in Envio or RPC clients
- add login providers through `auth_identities`
- add delivery channels as separate services behind the webhook boundary

## Related Docs

- [DSL.md](./DSL.md) for user-facing signal structure
- [API.md](./API.md) for HTTP routes
- [AUTH.md](./AUTH.md) for the control-plane auth model
- [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md) for delivery-specific contracts
- [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md) for why the system looks this way
