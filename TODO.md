# 📋 Flare Implementation TODO

## Phase 1: Core Engine & Data (Current)
- [x] Initial scaffold & Git repo
- [x] Core recursive `evaluateNode` engine
- [x] Initial unit tests for evaluator
- [x] **Envio Client** (`src/envio/client.ts`)
    - [x] GraphQL request logic
    - [x] Batching support (hoisting queries)
    - [x] Time-travel queries (block height support)
    - [x] Entity types: Position, Market, MorphoEvent
- [ ] **Block Resolver** (`src/envio/blocks.ts`)
    - [ ] Logic to convert timestamps to block heights (time-travel)
- [ ] **Condition Evaluator** (`src/engine/condition.ts`)
    - [ ] Logic to compare two `ExpressionNodes`

## Phase 2: Signal Infrastructure
- [x] **PostgreSQL Schema** (`src/db/schema.sql`)
    - [x] Signals, notification logs, snapshot blocks
    - [x] Evaluation cache table
    - [x] Repository classes with CRUD operations
- [ ] **Signal CRUD API** (`src/api/routes/signals.ts`)
    - [ ] Zod validation for complex DSL
- [ ] **Simulation Engine**
    - [ ] Reuse `evaluateNode` with historical block overrides

## Phase 3: Worker & Scaling
- [ ] **BullMQ Setup**
    - [ ] `SignalCheck` producer (scheduler)
    - [ ] `Evaluation` worker (consumer)
- [ ] **Smart Query Batching**
    - [ ] Grouping multiple signals by scope to minimize Envio calls
- [ ] **Webhook Dispatcher**
    - [ ] Retry logic & notification logging

## Phase 4: Polish & Integration
- [ ] **Monarch FE Integration**
- [ ] **Prometheus Metrics** (evaluation times, success rates)
- [ ] **Comprehensive Integration Tests**
