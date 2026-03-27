# Source Model

This document owns Sentinel's data-source model: the canonical source families, their current providers, capability gating, and the extension path for future sources.

## Current Contract

Sentinel exposes three source families to DSL authors:

| Family | User-facing DSL shape | Current provider | Purpose |
| --- | --- | --- | --- |
| state | `metric` on state-based conditions | RPC | current and historical state snapshots |
| indexed | `metric` on semantic event/entity conditions | Envio | protocol-aware indexed history |
| raw | `type: "raw-events"` | HyperSync | high-throughput raw decoded event scans |

The important boundary is family-first, not provider-first.
Users write `state`, `indexed`, and `raw` semantics.
The engine decides whether those reads land on RPC, Envio, HyperSync, or a future provider.

## Capability Gating

Source families are optional at runtime:

| Family | Required config today | Behavior if missing |
| --- | --- | --- |
| state | none | stays enabled through RPC fallbacks |
| indexed | `ENVIO_ENDPOINT` | API rejects indexed signal definitions and activation attempts |
| raw | `ENVIO_API_TOKEN` | API rejects `raw-events` signal definitions and activation attempts |

The service does not crash when optional source config is missing.
Instead:

- startup logs which families are enabled or disabled
- `GET /health` returns source capability status
- `GET /ready` verifies configured providers are reachable
- create, update, toggle-on, and simulate routes fail with a clear `409` if a disabled family is requested
- worker evaluation errors stay per-signal and explicit instead of taking down the process

## How Sources Fit Into The AST

Today the AST already has the right shape for mixed-source evaluation:

- `StateRef` for RPC-backed state
- `EventRef` for indexed semantic history
- `RawEventRef` for raw decoded events
- `BinaryExpression` for arithmetic composition across leaf refs
- `Condition` for final comparisons

That means Sentinel can already combine families inside one condition tree.
For example, a future expression can compare or combine state, indexed, and raw leaves without changing the evaluator model.

## Extension Path

There are two different kinds of future source work.

### 1. New Provider For An Existing Family

Example: swap Envio for another indexed provider, or add a second raw provider next to HyperSync.

Do this by:

1. extending source capability detection
2. extending `src/engine/source-plan.ts`
3. updating `src/indexing` or provider adapters
4. keeping the DSL unchanged

This is the cheapest path because the AST leaf type does not change.

### 2. New Family Or New Leaf Ref

Example: traces, transactions, blocks, or an offchain analytics dataset that does not fit `state`, `indexed`, or `raw-events`.

Do this by:

1. adding a new DSL condition or ref shape
2. adding a new AST leaf ref type
3. teaching the compiler how to emit that ref
4. teaching the planner how to bind that ref to a provider
5. keeping provider details out of the DSL

This preserves the same compiler -> planner -> evaluator layering.

## Future Mixed-Source Metrics

The cleanest long-term model is:

- keep user DSL semantic
- let the metric registry describe which source families a metric depends on
- compile each metric into one or more AST leaf refs
- let the planner bind each leaf independently
- combine results through normal expression nodes

That means a future computed metric can span multiple families without turning the DSL into a provider config language.

Concrete example:

- a future metric could divide RPC market state by raw swap volume
- another could combine indexed protocol events with raw token transfers
- both still compile into normal expression trees

The metric registry is the right place to describe those dependencies. The planner is the right place to decide which provider serves each dependency.

## Design Rules

- never expose vendor names as the primary product abstraction
- keep the DSL semantic and stable
- keep provider selection in the planner and source-capability layer
- prefer extending existing families before inventing a new one
- only add a new AST leaf type when the data shape truly does not fit an existing family

## Related Docs

- [DSL.md](./DSL.md) for the public signal contract
- [ARCHITECTURE.md](./ARCHITECTURE.md) for runtime boundaries
- [API.md](./API.md) for health and signal-route behavior
