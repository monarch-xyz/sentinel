# Flare Implementation Plan

> Generated with Gemini 2.5 Pro | 2026-02-03
> Total: 18 tasks across 5 categories

---

## 1. Data Layer

### FLARE-001: DB Schema Foundation
- **Description:** Define and implement the initial PostgreSQL schema using migrations. Tables for `signals`, `conditions`, and `notification_channels`.
- **Acceptance Criteria:**
    - Migrations can be applied and reverted
    - `signals` table with `name`, `description`, `status`, `dsl_definition` (JSONB)
    - `notification_channels` table for webhook URLs and types
    - Foreign key relationships properly defined
- **Dependencies:** None
- **Estimated Hours:** 3

### FLARE-002: Advanced Envio Client - State Queries
- **Description:** Extend Envio client to support generic state queries. Create dynamic GraphQL queries for contract view functions.
- **Acceptance Criteria:**
    - Function `queryState(chain, block, address, abi, functionName, args)` works
    - Correctly formats GraphQL queries for Envio's resolvers
    - Can query simple state values (e.g., `totalSupply`)
    - Unit tests cover different data types and argument encoding
- **Dependencies:** None
- **Estimated Hours:** 4

### FLARE-003: Block Number Resolver Service
- **Description:** Service to find closest block number to a given timestamp per chain. Uses binary search against Envio `blocks` table.
- **Acceptance Criteria:**
    - Function `getBlockNumber(chain, timestamp)` returns block number
    - Efficient with result caching for recent timestamps
    - Handles edge cases (timestamp before first indexed block)
- **Dependencies:** FLARE-002
- **Estimated Hours:** 3

### FLARE-004: DB Schema for Historical Snapshots
- **Description:** Schema for storing historical state snapshots when signals trigger.
- **Acceptance Criteria:**
    - `state_snapshots` table created
    - Stores value (JSONB), signal reference, block number, timestamp
    - Optimized for write-heavy operations and queries by signal ID
- **Dependencies:** FLARE-001
- **Estimated Hours:** 2

---

## 2. Core Engine

### FLARE-005: Condition Evaluator for State
- **Description:** Upgrade `evaluateNode` engine to resolve StateRef objects and handle time-window expressions.
- **Acceptance Criteria:**
    - Evaluator fetches live data via Envio client for StateRef
    - Translates time windows (e.g., `now-24h`) into block numbers
    - Compares live StateRef with historical snapshots
    - Unit tests cover operators (>, <, =, % change) and data types
- **Dependencies:** FLARE-002, FLARE-003, FLARE-004
- **Estimated Hours:** 4

### FLARE-006: Signal Runner Service
- **Description:** Orchestrator that executes a single signal end-to-end: parse DSL, fetch data, evaluate conditions.
- **Acceptance Criteria:**
    - Function `runSignal(signalId)` works
    - Fetches signal definition from DB
    - Uses Envio client for all data needs
    - Returns boolean result + evaluation data
    - Stateless — relies on inputs and database only
- **Dependencies:** FLARE-005
- **Estimated Hours:** 3

---

## 3. API Layer

### FLARE-007: Zod Validation for DSL
- **Description:** Create comprehensive Zod schemas for validating incoming DSL structures.
- **Acceptance Criteria:**
    - Validates all DSL primitives (EventRef, StateRef, Expression, Condition)
    - Recursive validation for nested expressions
    - Clear error messages for invalid DSL
    - Unit tests for valid and invalid DSL structures
- **Dependencies:** None
- **Estimated Hours:** 2

### FLARE-008: CRUD API for Signals
- **Description:** REST endpoints for signal management with DSL validation.
- **Acceptance Criteria:**
    - `POST /signals`, `GET /signals/:id`, `PUT /signals/:id`, `DELETE /signals/:id`
    - Input validation via Zod
    - API key authentication middleware
    - Full test coverage
- **Dependencies:** FLARE-001, FLARE-007
- **Estimated Hours:** 4

### FLARE-009: CRUD API for Notification Channels
- **Description:** Endpoints for managing notification channels with secure secret handling.
- **Acceptance Criteria:**
    - Full CRUD endpoints for notification channels
    - Secrets not returned in API responses
    - Validation for supported channel types
- **Dependencies:** FLARE-001
- **Estimated Hours:** 2

### FLARE-010: Signal Simulation Endpoint
- **Description:** Read-only `/simulate` endpoint to test signals without persistence.
- **Acceptance Criteria:**
    - `POST /simulate` accepts full signal DSL
    - Uses Signal Runner Service for evaluation
    - Returns boolean result + evaluation trace
    - No DB writes or job enqueuing
- **Dependencies:** FLARE-006
- **Estimated Hours:** 4

### FLARE-011: List & Filter Signals API
- **Description:** Endpoint to list signals with filtering, pagination, and sorting.
- **Acceptance Criteria:**
    - `GET /signals` with query params for status, chain, pagination
    - Efficient database queries
    - Returns metadata (total count, page info)
- **Dependencies:** FLARE-008
- **Estimated Hours:** 2

---

## 4. Worker Layer

### FLARE-012: Signal Scheduler Worker
- **Description:** BullMQ worker that schedules signal checks periodically.
- **Acceptance Criteria:**
    - Repeatable BullMQ job runs on schedule
    - Fetches active signals from DB
    - Enqueues jobs to `signal-processor` queue with signalId + blockNumber
    - Avoids duplicate job enqueueing
- **Dependencies:** FLARE-001
- **Estimated Hours:** 3

### FLARE-013: Signal Processor Worker
- **Description:** BullMQ worker that evaluates signals and triggers notifications.
- **Acceptance Criteria:**
    - Consumes from `signal-processor` queue
    - Calls Signal Runner Service
    - On trigger: enqueues notification job + writes snapshot
    - Graceful error handling with retry logic
- **Dependencies:** FLARE-006, FLARE-012
- **Estimated Hours:** 4

### FLARE-014: Notifier Worker
- **Description:** Worker that sends webhook notifications with retry logic.
- **Acceptance Criteria:**
    - Consumes from `notification` queue
    - Fetches channel details from DB
    - Sends formatted webhook payload
    - Exponential backoff retry for failures
    - Logs outcomes to `notification_logs` table
- **Dependencies:** FLARE-001, FLARE-013
- **Estimated Hours:** 3

### FLARE-015: Cooldown & Rate Limiting
- **Description:** Implement per-signal cooldown to prevent notification spam.
- **Acceptance Criteria:**
    - Signals have configurable `cooldown_minutes`
    - Processor respects cooldown before triggering
    - Tracks `last_triggered_at` in DB
- **Dependencies:** FLARE-013
- **Estimated Hours:** 2

---

## 5. Integration & Testing

### FLARE-016: E2E Test - Simple Event Signal
- **Description:** First end-to-end test using mocked Envio client.
- **Acceptance Criteria:**
    - Creates signal via API
    - Manually triggers scheduler
    - Mocked Envio returns expected event data
    - Asserts notification job is enqueued
- **Dependencies:** FLARE-008, FLARE-013
- **Estimated Hours:** 4

### FLARE-017: E2E Test - Complex Multi-Condition Signal
- **Description:** E2E test for signals with multiple conditions and time windows.
- **Acceptance Criteria:**
    - Tests AND/OR logic for multiple conditions
    - Tests time-window comparisons (current vs window_start)
    - Tests snapshot storage on trigger
- **Dependencies:** FLARE-016
- **Estimated Hours:** 3

### FLARE-018: System Monitoring & Health Checks
- **Description:** Structured logging, health endpoints, and job queue monitoring.
- **Acceptance Criteria:**
    - `/health` returns 200 if API, DB, Redis alive
    - Structured JSON logs with service names and trace IDs
    - BullMQ Arena or similar UI configured
- **Dependencies:** All layers
- **Estimated Hours:** 3

### FLARE-019: Docker Compose for Local Environment
- **Description:** Full local dev environment orchestration.
- **Acceptance Criteria:**
    - Single `docker-compose up` starts everything
    - Live-reloading for code changes
    - Seed script for test data
- **Dependencies:** All components
- **Estimated Hours:** 3

---

## Summary

| Category | Tasks | Total Hours |
|----------|-------|-------------|
| Data Layer | 4 | 12h |
| Core Engine | 2 | 7h |
| API Layer | 5 | 14h |
| Worker Layer | 4 | 12h |
| Integration | 4 | 13h |
| **TOTAL** | **19** | **58h** |

## Suggested Implementation Order

**Phase 1 - Foundation (Week 1):**
- FLARE-001, FLARE-002, FLARE-003, FLARE-007

**Phase 2 - Core Engine (Week 2):**
- FLARE-004, FLARE-005, FLARE-006

**Phase 3 - API (Week 2-3):**
- FLARE-008, FLARE-009, FLARE-010, FLARE-011

**Phase 4 - Workers (Week 3):**
- FLARE-012, FLARE-013, FLARE-014, FLARE-015

**Phase 5 - Integration (Week 4):**
- FLARE-016, FLARE-017, FLARE-018, FLARE-019
