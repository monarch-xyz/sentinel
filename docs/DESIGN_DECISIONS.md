# Sentinel Design Decisions

This document tracks high-level architectural decisions for Sentinel.

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
**Problem:** Two different condition schemas — expression tree in evaluator vs named conditions in API docs.  
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

### Decision 6: Qualified Metric Names Only
**Problem:** Having both `supply_assets` and `Morpho.Position.supplyShares` creates confusion.  
**Fix:** Removed alias names. Only qualified names are valid.  
**Rationale:** Cleaner API, explicit protocol namespacing, easier to extend.

### Decision 7: Chained Event Metrics
**Problem:** Users want `netSupply = Supply - Withdraw` but couldn't express event combinations.  
**Fix:** Added `chained_event` metric type in registry. Compiler builds expression trees automatically.  
**Example:** `Morpho.Flow.netSupply` compiles to `EventRef(Supply) - EventRef(Withdraw)`.

---

## 🔧 Operational + Product Decisions (2026-02-07)

### Decision 8: Per-Condition Windows
**Problem:** Signals needed mixed timeframes (e.g., 1d and 3d) in a single alert.  
**Fix:** Added optional `window` on every condition. The signal-level window remains the default.  
**Rationale:** Keeps DSL concise for common cases, but allows multi-timeframe logic when needed.

### Decision 9: Group Conditions Can Contain Multiple Inner Conditions
**Problem:** Two group conditions could be satisfied by different addresses, which breaks “same address” intent.  
**Fix:** `group` now accepts `conditions[]` + `logic` (AND/OR) evaluated per address.  
**Rationale:** Enables “same address must satisfy multiple checks” without adding a new condition type.

### Decision 10: API Keys Stored in DB (No Static API_KEY)
**Problem:** A single static API key doesn’t support multiple users, rotation, or auditability.  
**Fix:** Added `/auth/register` to create a user + API key stored in DB, used via `X-API-Key`.  
**Rationale:** Minimal auth layer that is easy to extend and supports future payment gating.

### Decision 11: Webhook Signing + Idempotency
**Problem:** Consumers need verification, retry safety, and replay protection.  
**Fix:** Added `X-Sentinel-Signature` with `X-Sentinel-Timestamp` (`HMAC(secret, "<ts>.<payload>")`) and `Idempotency-Key`.  
**Rationale:** Standard webhook integrity with minimal surface area.

### Decision 12: Envio Schema Validation (MVP Guardrail)
**Problem:** Field names differ from assumptions (`market_id`, `onBehalf`), leading to silent query errors.  
**Fix:** Schema introspection validates event filter fields; mapping normalizes `user` → `onBehalf` and `marketId` → `market_id`.  
**Rationale:** Fail fast on schema drift; avoid hard-to-debug runtime failures.

### Decision 13: In-Memory Rate Limiting (Temporary)
**Problem:** Simulations can be abused; we need guardrails immediately.  
**Fix:** Added in-memory rate limiting for `/simulate` endpoints.  
**Rationale:** Sufficient for single-instance MVP; will move to Redis for shared limits.

### Decision 14: x402 Deferred (Monetization Later)
**Problem:** x402 integration adds complexity to MVP without immediate benefit.  
**Fix:** Defer x402; keep API key flow stable; plan to gate `/auth/register` with x402 later.  
**Rationale:** Keep MVP complexity low while preserving a clear evolution path.

## 📖 Example: "Alert when position drops 20%"

This walkthrough shows how a user condition flows through each component.

### Step 1: User writes DSL
```json
{
  "type": "change",
  "metric": "Morpho.Position.supplyShares",
  "direction": "decrease",
  "by": { "percent": 20 },
  "chain_id": 1,
  "market_id": "0x...",
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

### Step 4: Data fetching (hybrid approach)

**Current state** → `EnvioClient.fetchState()` (GraphQL):
```graphql
query { Position(where: {user: {_eq: "0xwhale"}}) { supplyShares } }
```

**Historical state** → `RpcClient.readPositionAtBlock()` (direct contract read):
```typescript
// For window_start - RPC eth_call at specific block
const position = await morphoContract.read.position(
  [marketId, user],
  { blockNumber: 12345678n }
);
```

> ⚠️ **Note:** Envio does NOT support block-parameter time-travel (`block: {number: X}`). Point-in-time state reads use RPC.

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

### 1. Complementary Data Sources (Envio + RPC)
Sentinel uses the **Envio Indexer** (GraphQL) for indexed current state and events, and **RPC** for point-in-time state reads at specific blocks. They are complementary: Envio provides indexed views and event streams, RPC provides authoritative state snapshots.

### 2. Composable DSL
We use a primitive-based tree DSL instead of hardcoded metrics.
- **Primitives:** `EventRef`, `StateRef`, `Expression`, and `Condition`.
- **Benefit:** Decouples the backend from protocol-specific logic. Complex monitoring rules can be defined entirely via JSON without changing service code.

### 3. Hybrid Data Strategy (Envio + RPC)
Sentinel uses a hybrid approach with clear separation of responsibilities:

| Query Type | Data Source | Why |
|------------|-------------|-----|
| Current state (latest) | Envio GraphQL | Fast, indexed, multi-chain |
| Point-in-time state | RPC `eth_call` | Precise snapshot at block height |
| Events (time range) | Envio GraphQL | Timestamped, indexed |
| Block resolution | RPC | Binary search to find block for timestamp |

> **Original design note:** We initially planned to use Envio's time-travel queries, but discovered they're not supported. This clarified the separation: Envio for indexed data and RPC for point-in-time state. See `docs/ISSUE_NO_TIME_TRAVEL.md`.

### 4. Job Queue Scaling
Sentinel uses **BullMQ (Redis)** for job distribution from day one. This allows the service to scale horizontally and ensures that long-running evaluations do not block the event loop or other signals.

### 5. Webhook-First Notifications
Sentinel follows a strict "Everything is a Webhook" architecture. Integrations with specific platforms (Telegram, Discord) are handled via external notification tunnels, keeping the core engine agnostic.
