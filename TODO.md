# 📋 Flare Implementation TODO

## Phase 0: DSL Hardening (2026-02-03) ✅
- [x] Centralized `parseDuration` utility (`src/utils/duration.ts`)
- [x] Explicit division-by-zero error handling (`EvaluationError`)
- [x] Fail-loud on Envio query errors (`EnvioQueryError`)
- [x] Expression depth validation (`src/utils/validation.ts`)
- [x] Conclusive/inconclusive evaluation results
- [x] **Unified type system** — `src/engine/compiler.ts` transforms user DSL → expression tree
    - [x] ThresholdCondition → StateRef/EventRef comparison
    - [x] ChangeCondition → current vs past expression
    - [x] GroupCondition → CompiledGroupCondition for N-of-M evaluation
    - [x] AggregateCondition → aggregated state comparison
    - [x] Special handling for computed metrics (e.g., market_utilization)
- [x] **Extensible Metric Registry** (`src/engine/metrics.ts`)
    - [x] Qualified names: `Morpho.Position.supplyShares`, `Morpho.Market.utilization`
    - [x] Legacy aliases for backwards compatibility
    - [x] Easy to add new protocols/entities
- [x] **Doc Consolidation**
    - [x] `ARCHITECTURE.md` — single source of truth for DSL, metrics, flow
    - [x] Archived redundant docs (DESIGN.md, DSL.md, QUERY_SYSTEM.md)
    - [x] Updated README with clear doc links

## Phase 1: Core Engine & Data
- [x] Initial scaffold & Git repo
- [x] Core recursive `evaluateNode` engine
- [x] Initial unit tests for evaluator
- [x] **Envio Client** (`src/envio/client.ts`)
    - [x] GraphQL request logic
    - [x] Batching support (hoisting queries)
    - [x] Time-travel queries (block height support)
    - [x] Entity types: Position, Market, MorphoEvent
- [x] **Block Resolver** (`src/envio/blocks.ts`)
    - [x] Logic to convert timestamps to block heights (time-travel)
    - [x] Binary search with backwards estimation from latest block
    - [x] Support for fast chains (Arbitrum <1s blocks)
- [x] **Condition Evaluator** (`src/engine/evaluator.ts`)
    - [x] `evaluateNode()` - recursive expression evaluation
    - [x] `evaluateCondition()` - comparison of two ExpressionNodes
    - [x] `SignalEvaluator` class (`condition.ts`) - orchestrates evaluation with EnvioClient

## Phase 2: Signal Infrastructure
- [x] **PostgreSQL Schema** (`src/db/schema.sql`)
    - [x] Signals, notification logs, snapshot blocks
    - [x] Evaluation cache table
    - [x] Repository classes with CRUD operations
- [x] **Signal CRUD API** (`src/api/routes/signals.ts`)
    - [x] Zod validation for complex DSL
    - [x] PATCH /:id for partial updates
    - [x] PATCH /:id/toggle for toggling is_active
- [x] **Simulation Engine** (`src/engine/simulation.ts`)
    - [x] `simulateSignal()` - evaluate at historical timestamp
    - [x] `simulateSignalOverTime()` - backtest over time range
    - [x] `findFirstTrigger()` - binary search for first trigger

## Phase 3: Worker & Scaling
- [x] **BullMQ Setup** (`src/worker/`)
    - [x] `scheduler.ts` - repeatable job that queues active signals
    - [x] `processor.ts` - worker that evaluates signals
    - [x] `connection.ts` - shared Redis connection
- [x] **Webhook Dispatcher** (`src/worker/notifier.ts`)
    - [x] `dispatchNotification()` with timeout
    - [x] Notification logging to DB
    - [x] Cooldown enforcement
- [ ] **Smart Query Batching** (optimization)
    - [ ] Grouping multiple signals by scope to minimize Envio calls

## Phase 4: Polish & Integration
- [ ] **Monarch FE Integration**
- [ ] **Prometheus Metrics** (evaluation times, success rates)
- [ ] **Comprehensive Integration Tests**
