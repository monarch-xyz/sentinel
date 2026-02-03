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
- `Morpho.Market.utilization` → computed as `totalBorrow / totalSupply`
- Group conditions return `CompiledGroupCondition` for special evaluator handling

### Decision 6: Remove Legacy Metric Aliases
**Problem:** Having both `supply_assets` and `Morpho.Position.supplyShares` creates confusion.  
**Fix:** Removed all legacy aliases. Only qualified names are valid.  
**Rationale:** Cleaner API, explicit protocol namespacing, easier to extend.

**Migration from legacy names:**
| Legacy Name | New Qualified Name |
|-------------|-------------------|
| `supply_assets` | `Morpho.Position.supplyShares` |
| `supply_shares` | `Morpho.Position.supplyShares` |
| `borrow_assets` | `Morpho.Position.borrowShares` |
| `borrow_shares` | `Morpho.Position.borrowShares` |
| `collateral_assets` | `Morpho.Position.collateral` |
| `market_total_supply` | `Morpho.Market.totalSupplyAssets` |
| `market_total_borrow` | `Morpho.Market.totalBorrowAssets` |
| `market_utilization` | `Morpho.Market.utilization` |
| `net_supply_flow` | `Morpho.Flow.netSupply` |
| `net_borrow_flow` | `Morpho.Flow.netBorrow` |
| `liquidation_volume` | `Morpho.Event.Liquidate.repaidAssets` |

### Decision 7: Chained Event Metrics
**Problem:** Users want `netSupply = Supply - Withdraw` but couldn't express event combinations.  
**Fix:** Added `chained_event` metric type in registry. Compiler builds expression trees automatically.  
**Example:** `Morpho.Flow.netSupply` compiles to `EventRef(Supply) - EventRef(Withdraw)`.

---

## 📖 Example: "Alert when position drops 20%"

This walkthrough shows how a user condition flows through each component.

### Step 1: User writes DSL
```json
{
  "type": "change",
  "metric": "supply_assets",
  "direction": "decrease",
  "by": { "percent": 20 },
  "address": "0xwhale..."
}
```

### Step 2: Compiler transforms → Expression Tree
`src/engine/compiler.ts` → `compileChange()`

```
Condition:
  left: StateRef(Position.supplyShares, snapshot="current", user="0xwhale")
  operator: "lt"
  right: Expression(
    operator: "mul"
    left: StateRef(Position.supplyShares, snapshot="window_start", user="0xwhale")
    right: Constant(0.8)   ← (1 - 0.20)
  )
```

**Logic:** `current < past * 0.8` means "current is less than 80% of past" = 20% drop.

### Step 3: Evaluator recursively evaluates
`src/engine/evaluator.ts` → `evaluateNode()`

```
1. evaluateNode(right.left)  → fetchState(window_start) → 1000 tokens
2. evaluateNode(right.right) → constant → 0.8
3. evaluateNode(right)       → 1000 * 0.8 = 800
4. evaluateNode(left)        → fetchState(current) → 750 tokens
5. evaluateCondition()       → 750 < 800 → TRUE ✓
```

### Step 4: EnvioClient fetches data
`src/envio/client.ts` → `fetchState()`

```graphql
# For current state
query { Position(where: {user: {_eq: "0xwhale"}}) { supplyShares } }

# For window_start (time-travel via block number)
query { Position(where: {user: {_eq: "0xwhale"}}, block: {number: 12345678}) { supplyShares } }
```

### Step 5: Result
```json
{
  "signalId": "sig-123",
  "triggered": true,
  "timestamp": 1706886000000,
  "conclusive": true
}
```

→ Webhook fires with alert payload.

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
