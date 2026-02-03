# Flare Architecture

> Complete technical reference for the Flare signal monitoring system.

---

## Overview

Flare is a **composable signal monitoring service** for DeFi. Users define conditions using a DSL, and Flare evaluates them against blockchain data, sending webhooks when conditions trigger.

```
┌─────────────────────────────────────────────────────────────┐
│                         FLARE                               │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   REST API   │    │   COMPILER   │    │   WORKER     │  │
│  │   (CRUD +    │───▶│  (DSL → AST) │    │  (Scheduler  │  │
│  │   Validate)  │    └──────┬───────┘    │   + Notify)  │  │
│  └──────────────┘           │            └──────┬───────┘  │
│                             ▼                   │          │
│                    ┌────────────────┐           │          │
│                    │   EVALUATOR    │◀──────────┘          │
│                    │  (Expression   │                      │
│                    │    Engine)     │                      │
│                    └────────┬───────┘                      │
│                             │                              │
│              ┌──────────────┴──────────────┐               │
│              ▼                             ▼               │
│    ┌──────────────────┐          ┌──────────────────┐      │
│    │   EnvioClient    │          │    RpcClient     │      │
│    │   (GraphQL)      │          │   (eth_call)     │      │
│    │                  │          │                  │      │
│    │ • Current state  │          │ • Historical     │      │
│    │ • Events         │          │   state          │      │
│    └────────┬─────────┘          └────────┬─────────┘      │
└─────────────┼──────────────────────────────┼───────────────┘
              │                              │
    ┌─────────▼─────────┐          ┌─────────▼─────────┐
    │  ENVIO INDEXER    │          │   RPC ENDPOINTS   │
    │  (7 chains)       │          │   (per chain)     │
    └───────────────────┘          └───────────────────┘
```

---

## Core Components

### 1. Compiler (`src/engine/compiler.ts`)

Transforms user-friendly DSL into evaluator-ready expression trees.

**Input (User DSL):**
```json
{
  "type": "change",
  "metric": "Morpho.Position.supplyShares",
  "direction": "decrease",
  "by": { "percent": 20 }
}
```

**Output (Expression Tree):**
```
Condition:
  left: StateRef(current)
  operator: "lt"
  right: Expression(mul, StateRef(window_start), Constant(0.8))
```

### 2. Evaluator (`src/engine/evaluator.ts`)

Recursively evaluates expression trees to produce boolean results.

- `evaluateNode()` — resolves any node to a number
- `evaluateCondition()` — compares two nodes, returns boolean
- Throws `EvaluationError` on division by zero or invalid nodes

### 3. Metric Registry (`src/engine/metrics.ts`)

Extensible mapping of metric names to data sources.

```typescript
// Qualified names (required)
"Morpho.Position.supplyShares"
"Morpho.Market.totalBorrowAssets"
"Morpho.Event.Supply.assets"
```

### 4. EnvioClient (`src/envio/client.ts`)

GraphQL client for fetching **indexed current state** and **events** from Envio.

- ⚠️ **Does NOT support time-travel** (no `block: {number: X}`)
- ⚠️ **Does NOT support `_aggregate`** - we aggregate in-memory
- Batch queries for efficiency
- Throws `EnvioQueryError` on failures (no silent zeros)

### 4b. RpcClient (`src/rpc/client.ts`)

Direct RPC client for **point-in-time state** queries.

- Uses `eth_call` with `blockNumber` parameter
- Required for `ChangeCondition` (compares current vs past)
- Reads Morpho contract directly via viem

### 5. SignalEvaluator (`src/engine/condition.ts`)

Orchestrates the full evaluation flow:
1. Parse window duration
2. Resolve block numbers for point-in-time snapshots (RPC)
3. Build evaluation context (routes to Envio or RPC per snapshot)
4. Call evaluator
5. Return conclusive/inconclusive result

---

## Expression Tree (Internal AST)

Threshold/change conditions compile to this structure:

```typescript
type ExpressionNode = 
  | Constant        // { type: "constant", value: 1000 }
  | StateRef        // { type: "state", entity_type, field, snapshot, filters }
  | EventRef        // { type: "event", event_type, field, aggregation, filters }
  | BinaryExpression // { type: "expression", operator, left, right }

interface Condition {
  type: "condition";
  left: ExpressionNode;
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
  right: ExpressionNode;
}

type CompiledCondition =
  | Condition
  | { type: "group"; addresses: string[]; requirement: { count: number; of: number }; perAddressCondition: Condition }
  | { type: "aggregate"; aggregation: "sum" | "avg" | "min" | "max" | "count"; metric: string; operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq"; value: number; chainId: number; marketIds?: string[]; addresses?: string[] };

interface CompiledSignalDefinition {
  chains: number[];
  window: { duration: string };
  conditions: CompiledCondition[];
  logic: "AND" | "OR";
}
```

Group/aggregate conditions are evaluated across the **scope** (markets/addresses) and do not duplicate those lists inside every condition.

### Node Types

| Type | Description | Example |
|------|-------------|---------|
| `Constant` | Literal number | `{ type: "constant", value: 0.9 }` |
| `StateRef` | Entity state at a point in time | Position balance, Market total supply |
| `EventRef` | Aggregated events over window | Sum of Supply events |
| `BinaryExpression` | Math operation on two nodes | `left / right` |

### Snapshot Options (StateRef)

| Value | Meaning | Data Source |
|-------|---------|-------------|
| `"current"` | Latest indexed state | Envio GraphQL |
| `"window_start"` | Block at start of signal's window | **RPC eth_call** |
| `"7d"`, `"2h"` | State N time ago | **RPC eth_call** |

> ⚠️ **Note:** Envio does not support block-parameter time-travel. Point-in-time snapshots are resolved via RPC.

---

## Metric Reference

All metrics use qualified names: `{Protocol}.{Entity}.{field}`

### Data Source by Metric Type

| Metric Type | Example | Indexed (Envio) | Point-in-Time (RPC) |
|-------------|---------|------------------|---------------------|
| Position | `Morpho.Position.supplyShares` | Latest state | **Block-specific** |
| Market | `Morpho.Market.totalSupplyAssets` | Latest state | **Block-specific** |
| Event | `Morpho.Event.Supply.assets` | Time-range events | N/A |
| Flow | `Morpho.Flow.netSupply` | Time-range events | N/A |
| Computed | `Morpho.Market.utilization` | Latest state | **Block-specific** |

> **Key insight:** Events are naturally time-bounded via timestamps. State needs point-in-time reads because it is a snapshot.

### State Metrics (Entity Properties)

```
Morpho.Position.supplyShares      # User's supply shares
Morpho.Position.borrowShares      # User's borrow shares
Morpho.Position.collateral        # User's collateral

Morpho.Market.totalSupplyAssets   # Total market supply
Morpho.Market.totalBorrowAssets   # Total market borrows
Morpho.Market.totalSupplyShares   # Total supply shares
Morpho.Market.totalBorrowShares   # Total borrow shares
Morpho.Market.fee                 # Market fee
```

### Computed Metrics (Derived from State)

```
Morpho.Market.utilization         # totalBorrow / totalSupply
```

### Event Metrics (Single Event Aggregation)

```
Morpho.Event.Supply.assets        # sum(Supply.assets)
Morpho.Event.Supply.count         # count(Supply events)
Morpho.Event.Withdraw.assets      # sum(Withdraw.assets)
Morpho.Event.Borrow.assets        # sum(Borrow.assets)
Morpho.Event.Repay.assets         # sum(Repay.assets)
Morpho.Event.Liquidate.repaidAssets
Morpho.Event.Liquidate.seizedAssets
```

### Chained Event Metrics (Event Combinations)

```
Morpho.Flow.netSupply             # Supply - Withdraw
Morpho.Flow.netBorrow             # Borrow - Repay
Morpho.Flow.totalLiquidations     # repaidAssets + seizedAssets
```

---

## Event-Based Alerts

Event metrics are first-class signals, not a workaround. They capture **activity** rather than **state**.

Typical uses:
- Sudden supply/withdraw spikes over a window
- Liquidation bursts
- Net flow reversals (e.g., net supply < 0 for 6h)

Events are always evaluated over a time range (window) and are complementary to point-in-time state checks.

---

## User DSL Reference

### Condition Types

#### ThresholdCondition
Simple value comparison.

```json
{
  "type": "threshold",
  "metric": "Morpho.Market.utilization",
  "operator": ">",
  "value": 0.9,
  "chain_id": 1,
  "market_id": "0x..."
}
```

**Required fields by metric type:**
| Metric Entity | Required Fields |
|---------------|-----------------|
| Position | `chain_id`, `market_id`, `address` |
| Market | `chain_id`, `market_id` |
| Event/Flow | `chain_id` |

#### ChangeCondition
Detect changes over time window.

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

**Directions:** `increase`, `decrease`, `any`
**By:** `{ percent: N }` or `{ absolute: N }`

#### GroupCondition
N-of-M address logic.

```json
{
  "type": "group",
  "addresses": ["0xa", "0xb", "0xc", "0xd", "0xe"],
  "requirement": { "count": 3, "of": 5 },
  "condition": {
    "type": "change",
    "metric": "Morpho.Position.supplyShares",
    "direction": "decrease",
    "by": { "percent": 10 }
  }
}
```

#### AggregateCondition
Aggregate values across scope.

```json
{
  "type": "aggregate",
  "aggregation": "sum",
  "metric": "Morpho.Market.totalSupplyAssets",
  "operator": ">",
  "value": 10000000
}
```

---

## Example Signals (Composed Conditions)

All conditions in a signal share the same `window`. Use `logic: "AND"` or `"OR"` to combine them.

### 1) Two Different State Checks (Market Stress)

```json
{
  "scope": { "chains": [1], "markets": ["0x..."] },
  "window": { "duration": "1h" },
  "logic": "AND",
  "conditions": [
    {
      "type": "threshold",
      "metric": "Morpho.Market.utilization",
      "operator": ">",
      "value": 0.9,
      "chain_id": 1,
      "market_id": "0x..."
    },
    {
      "type": "threshold",
      "metric": "Morpho.Market.totalBorrowAssets",
      "operator": ">",
      "value": 50000000,
      "chain_id": 1,
      "market_id": "0x..."
    }
  ]
}
```

### 2) State Change + State Change (Same Window)

```json
{
  "scope": { "chains": [1], "markets": ["0x..."], "addresses": ["0xwhale..."] },
  "window": { "duration": "7d" },
  "logic": "AND",
  "conditions": [
    {
      "type": "change",
      "metric": "Morpho.Position.supplyShares",
      "direction": "decrease",
      "by": { "percent": 20 },
      "chain_id": 1,
      "market_id": "0x...",
      "address": "0xwhale..."
    },
    {
      "type": "change",
      "metric": "Morpho.Market.totalSupplyAssets",
      "direction": "decrease",
      "by": { "percent": 15 },
      "chain_id": 1,
      "market_id": "0x..."
    }
  ]
}
```

### 3) State Change + Event Aggregation (Flow Confirmation)

```json
{
  "scope": { "chains": [1], "markets": ["0x..."], "addresses": ["0xwhale..."] },
  "window": { "duration": "7d" },
  "logic": "AND",
  "conditions": [
    {
      "type": "change",
      "metric": "Morpho.Position.supplyShares",
      "direction": "decrease",
      "by": { "percent": 15 },
      "chain_id": 1,
      "market_id": "0x...",
      "address": "0xwhale..."
    },
    {
      "type": "threshold",
      "metric": "Morpho.Flow.netSupply",
      "operator": "<",
      "value": 0,
      "chain_id": 1
    }
  ]
}
```

**Note:** Per-condition windows (e.g., 2d vs 7d in the same signal) are not supported yet. If you need mixed timeframes, split into separate signals for now.

---

## Evaluation Flow

```
1. API receives signal definition
   ↓
2. Compiler transforms DSL → Expression Tree
   ↓
3. Signal stored in PostgreSQL
   ↓
4. Worker scheduler triggers evaluation (every N seconds)
   ↓
5. SignalEvaluator orchestrates:
   a. Parse window duration → windowStart timestamp
   b. Resolve timestamps → block numbers (for RPC point-in-time queries)
   c. Build EvalContext with fetch functions (Envio + RPC)
   d. Call evaluateCondition(left, op, right, context)
   ↓
6. Evaluator recursively walks tree:
   - Constant → return value
   - StateRef → fetchState() (Envio for current, RPC for point-in-time)
   - EventRef → fetchEvents() (Envio indexer)
   - Expression → evaluate children, apply operator
   ↓
7. Result: { triggered: boolean, conclusive: boolean }
   ↓
8. If triggered → dispatch webhook
```

---

## Example: "Alert when position drops 20%"

### Step 1: User writes
```json
{
  "type": "change",
  "metric": "Morpho.Position.supplyShares",
  "direction": "decrease",
  "by": { "percent": 20 },
  "address": "0xwhale..."
}
```

### Step 2: Compiler transforms
```
Condition:
  left: StateRef(Position.supplyShares, snapshot="current", user="0xwhale")
  operator: "lt"
  right: Expression(
    operator: "mul"
    left: StateRef(Position.supplyShares, snapshot="window_start", user="0xwhale")
    right: Constant(0.8)
  )
```

**Logic:** `current < past * 0.8` means "current is less than 80% of past" = 20%+ drop.

### Step 3: Evaluator executes
```
1. Fetch current position  → 750
2. Fetch past position     → 1000
3. Compute threshold       → 1000 * 0.8 = 800
4. Compare                 → 750 < 800 = TRUE ✓
```

### Step 4: Webhook fires
```json
{
  "signal_id": "...",
  "triggered_at": "2026-02-03T14:30:00Z",
  "conditions_met": [{
    "type": "change",
    "description": "Position decreased by 25%",
    "actual_value": 750,
    "threshold": 800
  }]
}
```

---

## Error Handling

| Error | Thrown By | Handling |
|-------|-----------|----------|
| `EvaluationError` | evaluator.ts | Caught by SignalEvaluator, returns `conclusive: false` |
| `EnvioQueryError` | client.ts | Propagates up, evaluation marked inconclusive |
| `ValidationError` | validation.ts | Rejected at API layer before storage |

**Key principle:** Never silently return zeros. Fail loud, mark inconclusive.

---

## Adding New Metrics

1. Add to registry in `src/engine/metrics.ts`:
```typescript
'NewProtocol.Entity.field': {
  kind: 'state',
  entity: 'EntityName',
  field: 'fieldName',
}
```

2. If computed, implement in compiler:
```typescript
if (cond.metric === 'NewProtocol.Entity.computedField') {
  // Build expression tree
}
```

3. Update this doc's Metric Reference section.

---

## Testing Conditions Locally

Use the CLI to test if a condition would trigger:

```bash
# Test a threshold condition
pnpm test:condition --inline '{
  "type": "threshold",
  "metric": "Morpho.Market.utilization",
  "operator": ">",
  "value": 0.9
}'

# Test net supply flow over 7 days
pnpm test:condition --window 7d --inline '{
  "type": "threshold",
  "metric": "Morpho.Flow.netSupply",
  "operator": "<",
  "value": 0
}'

# Test 20% position drop
pnpm test:condition --window 7d --inline '{
  "type": "change",
  "metric": "Morpho.Position.supplyShares",
  "direction": "decrease",
  "by": { "percent": 20 },
  "address": "0x..."
}'

# Dry run (show AST without executing)
pnpm test:condition --dry-run --inline '...'

# Verbose mode (show all fetch calls)
pnpm test:condition --verbose --inline '...'
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/engine/compiler.ts` | DSL → Expression Tree |
| `src/engine/evaluator.ts` | Expression evaluation |
| `src/engine/metrics.ts` | Metric registry |
| `src/engine/condition.ts` | Orchestration |
| `src/envio/client.ts` | GraphQL data fetching |
| `src/envio/blocks.ts` | Timestamp → block resolution |
| `src/utils/duration.ts` | Duration parsing |
| `src/utils/validation.ts` | Input validation |
| `src/scripts/test-condition.ts` | CLI condition tester |

---

## Supported Chains

| Chain | ID | Block Time | Status |
|-------|-----|------------|--------|
| Ethereum | 1 | ~12s | ✅ Live |
| Base | 8453 | ~2s | ✅ Live |
| Polygon | 137 | ~2s | ✅ Live |
| Arbitrum | 42161 | ~0.25s | ✅ Live |
| Monad | 10143 | ~0.5s | 🔜 Pending |
| Unichain | 130 | ~2s | 🔜 Pending |
| Hyperliquid | 999 | ~1s | 🔜 Pending |

**Custom RPC:** Set `RPC_URL_{chainId}` env var (e.g., `RPC_URL_1=https://...`).

**Add new chain:** Update `CHAIN_CONFIGS` in `src/envio/blocks.ts`.
