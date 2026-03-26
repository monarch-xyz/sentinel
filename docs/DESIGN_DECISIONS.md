# Sentinel Design Decisions

This document tracks the major design decisions behind the current implementation. It is intentionally short and ADR-like; architecture walkthroughs live in [ARCHITECTURE.md](./ARCHITECTURE.md).

## DSL Hardening

### Decision 1: Centralized Duration Parsing

- problem: multiple duration parsers drifted on supported units
- fix: one shared parser in `src/utils/duration.ts`
- rationale: time windows must have one source of truth

### Decision 2: Explicit Division-By-Zero Handling

- problem: silent zero values created false evaluations
- fix: throw on division by zero
- rationale: fail loud is safer than fake certainty

### Decision 3: Fail-Loud Data Fetch Errors

- problem: upstream query failures looked like real zeroes
- fix: propagate fetch errors and mark evaluation inconclusive
- rationale: a missed alert is better than a false state reading

### Decision 4: Expression Depth Limit

- problem: unbounded expression nesting is an abuse and reliability risk
- fix: validate maximum expression depth
- rationale: there is no real product need for extreme nesting

### Decision 5: User DSL Compiles To Internal AST

- problem: user-facing conditions and evaluator internals had diverged
- fix: compile user DSL into one internal representation
- rationale: keep the external contract friendly and the evaluator generic

### Decision 6: Qualified Metric Names Only

- problem: aliases made the metric surface ambiguous
- fix: only accept fully-qualified metric names
- rationale: explicit protocol/entity naming scales cleanly

### Decision 7: Chained Event Metrics

- problem: users needed derived event flow metrics like net supply
- fix: support composed event metrics in the registry
- rationale: common monitoring logic should not require custom code

## Operational And Product Decisions

### Decision 8: Per-Condition Windows

- problem: one signal sometimes needs mixed time horizons
- fix: allow condition-level window overrides
- rationale: keep common cases short while supporting multi-timeframe alerts

### Decision 9: Group Conditions Support Multiple Inner Conditions

- problem: separate group conditions could be satisfied by different addresses
- fix: a group can hold multiple conditions evaluated per address
- rationale: this preserves "same address must satisfy all of these" semantics

### Decision 10: API Keys Stored In The Database

- problem: one static API key is not multi-user and not auditable
- fix: issue per-user keys through `/auth/register`
- rationale: this is the minimum auth surface that can still evolve

### Decision 10a: Dual Auth Over One Canonical Owner

- problem: browser users and API clients need different auth transports but must see the same resources
- fix: keep `users.id` as the canonical owner and let both sessions and API keys resolve to that same ID
- rationale: signal ownership, delivery mapping, and auth should not fork into separate identity systems

### Decision 10b: Provider-Agnostic Identities

- problem: SIWE solves the first login flow but not the eventual email or Google flows
- fix: store login methods in `auth_identities` keyed to `users.id`
- rationale: credentials can change without changing the owner ID that signals belong to

### Decision 11: Signed Webhooks And Idempotency

- problem: delivery targets need integrity and replay protection
- fix: sign payloads and include an idempotency key
- rationale: webhook consumers need a simple, standard trust model

### Decision 12: Envio Schema Validation

- problem: schema drift caused hard-to-debug runtime errors
- fix: validate expected fields up front
- rationale: surface integration problems at the boundary, not mid-evaluation

### Decision 13: In-Memory Simulation Rate Limiting

- problem: simulations can be abused immediately even in MVP form
- fix: use in-memory limits for now
- rationale: it is good enough until multi-instance deployment requires shared state

### Decision 14: x402 Deferred

- problem: payment gating adds product and engineering complexity too early
- fix: keep the API-key flow simple for now
- rationale: stable fundamentals beat premature monetization plumbing

### Decision 15: Explicit Source Planning

- problem: provider choice was leaking into fetcher internals and docs drifted
- fix: centralize source planning behind the engine boundary
- rationale: keep the DSL and evaluator independent from Envio vs RPC decisions

### Decision 16: Unified Indexing Boundary

- problem: indexed semantic reads and raw event scans shared the same product surface but were wired as separate provider details
- fix: compose Envio and HyperSync behind one indexing boundary used by the protocol fetchers
- rationale: the DSL should teach reference families, not vendor topology

### Decision 17: Optional Source Capability Gating

- problem: missing Envio or HyperSync config could crash startup or allow unsupported signals into the system
- fix: treat indexed and raw providers as optional capabilities, expose their status in health/startup, and reject unsupported API requests explicitly
- rationale: optional infra should degrade product surface cleanly, not take down the process

### Decision 18: Versioned SQL Migrations

- problem: database setup was split across Docker shell snippets and whole-schema reapply scripts
- fix: move database creation to Postgres init scripts and manage schema evolution with versioned SQL migrations
- rationale: production upgrades need explicit, repeatable schema history rather than startup side effects

### Decision 19: Sentinel-Native Telegram Status Endpoints

- problem: the web app should not need to speak directly to delivery or know the raw `app_user_id` wiring
- fix: expose Telegram link status and token-link routes through Sentinel, backed by delivery internal endpoints
- rationale: the web app stays thin while the delivery-service boundary remains intact

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) for the current runtime design
- [DSL.md](./DSL.md) for the user-facing signal contract
- [SOURCES.md](./SOURCES.md) for source-family capability and extension rules
- [ISSUE_NO_TIME_TRAVEL.md](./ISSUE_NO_TIME_TRAVEL.md) for the Envio/RPC split
