# 📋 Flare Implementation TODO

## 🚨 URGENT: RPC Historical State Integration (2026-02-03)

Envio does NOT support:
1. Time-travel queries (`block: {number: X}`)
2. `_aggregate` functions in production

See: [docs/ISSUE_NO_TIME_TRAVEL.md](docs/ISSUE_NO_TIME_TRAVEL.md)

### Migration Tasks

- [x] **1. Create RpcClient** (`src/rpc/client.ts`) ✅
  - [ ] Add viem as dependency (`pnpm add viem`) ← **USER TODO**
  - [x] Create `getPublicClient(chainId)` with RPC endpoint env vars
  - [x] Implement `readPositionAtBlock(chainId, marketId, user, blockNumber)`
  - [x] Implement `readMarketAtBlock(chainId, marketId, blockNumber)`
  - [x] Add Morpho ABI (`src/rpc/abi.ts`) with `position` and `market` view functions

- [x] **2. Create DataFetcher abstraction** ✅
  - [x] `src/engine/fetcher.ts` — protocol-agnostic `DataFetcher` interface
  - [x] `src/engine/morpho-fetcher.ts` — Morpho-specific implementation
    - Routes: `timestamp === undefined` → Envio, else → resolve block + RPC
    - Extracts fields from RPC results (Position, Market)
  - [x] `condition.ts` now takes `DataFetcher` (protocol-agnostic)
  - [x] Updated `test-condition.ts`, `processor.ts`, `simulate.ts` to use `createMorphoFetcher`
  - [ ] Unit tests for routing logic

- [x] **3. Remove broken code from EnvioClient** ✅
  - [x] Remove `block: {number: X}` from GraphQL queries (never worked)
  - [x] Remove `fetchStateAtTimestamp()`
  - [x] Keep: `fetchState()` for current state only
  - [x] Keep: `fetchEvents()` with in-memory aggregation

- [ ] **4. Update tests**
  - [x] Remove broken time-travel tests from envio.test.ts
  - [ ] Add RPC client unit tests
  - [ ] Mock RPC calls in evaluator tests
- [ ] Test ChangeCondition with RPC historical state
  - [ ] Integration test: real RPC + Envio

- [x] **5. Update documentation** ✅ (2026-02-03)
  - [x] Updated ARCHITECTURE.md diagram to show RPC + Envio
  - [x] Updated DESIGN_DECISIONS.md to describe hybrid strategy
  - [x] Updated README.md to remove "time-travel" claim
  - [x] Updated API.md to use qualified metric names
  - [x] Updated schema comments to clarify RPC usage

---

## Phase 0: DSL Hardening (2026-02-03) ✅
- [x] Centralized `parseDuration` utility (`src/utils/duration.ts`)
- [x] Explicit division-by-zero error handling (`EvaluationError`)
- [x] Fail-loud on Envio query errors (`EnvioQueryError`)
- [x] Expression depth validation (`src/utils/validation.ts`)
- [x] Conclusive/inconclusive evaluation results
- [x] DSL-first compiler + versioned AST storage (`src/engine/compile-signal.ts`)
- [x] **Unified type system** — `src/engine/compiler.ts` transforms user DSL → expression tree
    - [x] ThresholdCondition → StateRef/EventRef comparison
    - [x] ChangeCondition → current vs past expression
    - [x] GroupCondition → CompiledGroupCondition + evaluator
    - [x] AggregateCondition → CompiledAggregateCondition + evaluator
    - [x] Special handling for computed metrics (e.g., Morpho.Market.utilization)
- [x] Multi-condition logic (`AND` / `OR`) in evaluator
- [x] **Extensible Metric Registry** (`src/engine/metrics.ts`)
    - [x] Qualified names: `Morpho.Position.supplyShares`, `Morpho.Market.utilization`
    - [x] Legacy aliases for backwards compatibility
    - [x] Easy to add new protocols/entities
    - [x] Event count metrics (e.g., `Morpho.Event.Supply.count`)
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
    - [x] ~~Time-travel queries (block height support)~~ ⚠️ BROKEN - Envio doesn't support this
    - [x] Entity types: Position, Market, MorphoEvent
    - [x] In-memory aggregation (Envio doesn't support `_aggregate`)
- [x] **Block Resolver** (`src/envio/blocks.ts`)
    - [x] Logic to convert timestamps to block heights (for RPC calls)
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
