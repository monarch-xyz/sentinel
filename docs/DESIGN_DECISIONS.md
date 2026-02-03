# Flare Design Decisions

This document tracks high-level architectural decisions for Flare.

---

## 🔧 DSL Hardening (2026-02-03)

After a first-principles review of the DSL and evaluation engine, we identified and fixed several critical issues:

### Decision 1: Centralized Duration Parsing
**Problem:** Two separate `parseDuration` implementations with different supported units (one had weeks, other had seconds).  
**Fix:** Single `parseDuration` utility in `src/utils/duration.ts` supporting all units.  
**Rationale:** Single source of truth prevents silent bugs from unit mismatches.

### Decision 2: Explicit Division-by-Zero Handling
**Problem:** `left / right` returned `0` when `right === 0`, causing silent false positives.  
**Fix:** Throw `EvaluationError` on division by zero; callers handle explicitly.  
**Rationale:** Fail-fast prevents incorrect alerts. Users can use `coalesce` patterns if needed.

### Decision 3: Fail-Loud on Data Fetch Errors
**Problem:** Envio batch query failures returned zeros for all results → false evaluations.  
**Fix:** Propagate errors up the stack; mark evaluation as "inconclusive" rather than false.  
**Rationale:** Silent data failures are worse than no evaluation.

### Decision 4: Expression Depth Limit
**Problem:** Unbounded recursion in expression trees → potential stack overflow / DoS.  
**Fix:** Validate max depth (20 levels) at signal creation time.  
**Rationale:** No legitimate use case needs 20+ levels of nesting.

### Decision 5: Unified Condition Schema ✅
**Problem:** Two incompatible condition schemas — expression tree in evaluator vs named conditions in API docs.  
**Fix:** Created `src/engine/compiler.ts` that transforms user DSL → internal expression tree.  
**Rationale:** Keep user-friendly named conditions (ThresholdCondition, etc.) but ensure evaluator receives validated AST.

**Compiler transformations:**
| User DSL | Internal AST |
|----------|--------------|
| `ThresholdCondition` | `StateRef` or `EventRef` compared to `Constant` |
| `ChangeCondition` | `current` vs `past * (1±percent)` expression |
| `GroupCondition` | Special structure with per-address evaluation |
| `AggregateCondition` | Aggregated `StateRef` compared to `Constant` |

**Special cases:**
- `market_utilization` → computed as `totalBorrow / totalSupply`
- Group conditions return `CompiledGroupCondition` for special evaluator handling

---

## 📌 Core Architecture

### 1. Unified Data Source (Envio)
Flare uses the existing **Envio Indexer** (GraphQL) as its single source of truth. This eliminates the need to maintain multiple indexing stacks and ensures data consistency across the Monarch ecosystem.

### 2. Composable DSL
We use a primitive-based tree DSL instead of hardcoded metrics.
- **Primitives:** `EventRef`, `StateRef`, `Expression`, and `Condition`.
- **Benefit:** Decouples the backend from protocol-specific logic. Complex monitoring rules can be defined entirely via JSON without changing service code.

### 3. Stateless Snapshots (Time-Travel)
Instead of storing state snapshots in our database, Flare leverages Envio's **Time-Travel Queries** (`block: { number: ... }`). We resolve timestamps to block heights to query historical state directly from the indexer.

### 4. Job Queue Scaling
Flare uses **BullMQ (Redis)** for job distribution from day one. This allows the service to scale horizontally and ensures that long-running evaluations do not block the event loop or other signals.

### 5. Webhook-First Notifications
Flare follows a strict "Everything is a Webhook" architecture. Integrations with specific platforms (Telegram, Discord) are handled via external notification tunnels, keeping the core engine agnostic.
