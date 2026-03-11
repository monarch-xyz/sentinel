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

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) for the current runtime design
- [DSL.md](./DSL.md) for the user-facing signal contract
- [ISSUE_NO_TIME_TRAVEL.md](./ISSUE_NO_TIME_TRAVEL.md) for the Envio/RPC split
