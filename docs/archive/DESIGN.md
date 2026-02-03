# 🔥 Flare - Design Document

> **Project:** Flare — Composable Signal Monitoring for DeFi
> **Author:** Stark + Anton
> **Date:** 2026-02-02
> **Status:** RFC v2 — Flexible DSL

---

## Executive Summary

Flare is a **protocol-agnostic** monitoring service that lets users define complex conditions on blockchain data using composable primitives. Users can combine **events** and **state** with math expressions to create sophisticated signals.

**Key Design Principles:**
1. **General, not opinionated** — No hardcoded protocol concepts (markets, vaults)
2. **Composable** — Build complex metrics from simple primitives
3. **Events + State** — Query both event streams and entity state
4. **Time-aware** — Compare current values vs historical snapshots

---

## 1. Problem Statement

**Current monitoring tools are limited to:**
- Single events with thresholds (\"alert if TVL < X\")
- Simple state checks (\"alert if utilization > 90%\")
- Protocol-specific, hardcoded metrics

**Users want:**
- \"3 of 5 addresses reduce position by 10%+ each over 7 days\"
- \"Net supply flow (supply - withdraw) drops below 20% of starting position\"
- \"Liquidation volume exceeds 5% of total market supply\"

**Flare enables:**
- Composable expressions from events + state
- Generic filters (not hardcoded `market_id`, `address`)
- Math operations to derive metrics
- Time comparisons (`current` vs `window_start`)

---

## 2. Core Data Model

### 2.1 Primitives

The DSL is built from four primitives:

| Primitive | Description | Example |
|-----------|-------------|---------|
| **EventRef** | Aggregate events over time window | `sum(Supply.assets)` |
| **StateRef** | Read entity state at a point in time | `Position.supply_assets` |
| **Expression** | Math operations on values | `EventA - EventB` |
| **Condition** | Compare two expressions | `expr < threshold` |

### 2.2 Filter (Generic)

Replaces hardcoded fields like `market_id`, `address`:

```typescript
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

interface Filter {
  field: string;      // Any field name from the event/entity
  op: FilterOp;
  value: string | number | boolean | string[];
}
```

**Examples:**
```json
{\"field\": \"user\", \"op\": \"eq\", \"value\": \"0x123...\"}
{\"field\": \"market_id\", \"op\": \"in\", \"value\": [\"0xabc\", \"0xdef\"]}\n{\"field\": \"assets\", \"op\": \"gte\", \"value\": 1000000}
```

### 2.3 EventRef

Aggregate values from an event stream over the signal's time window:

```typescript
interface EventRef {
  type: 'event';
  event_type: string;       // e.g., \"Supply\", \"Withdraw\", \"Liquidate\"
  filters: Filter[];        // Generic filters
  field: string;            // Numeric field to extract
  aggregation: 'sum' | 'count' | 'avg' | 'min' | 'max';
}
```

**Example: Sum of supply assets for a user**
```json
{
  \"type\": \"event\",
  \"event_type\": \"Supply\",
  \"filters\": [{\"field\": \"user\", \"op\": \"eq\", \"value\": \"0x123\"}],
  \"field\": \"assets\",
  \"aggregation\": \"sum\"
}
```

### 2.4 StateRef

Read a property from an entity at a specific time:

```typescript
interface StateRef {
  type: 'state';
  entity_type: string;      // e.g., \"Position\", \"Market\", \"Vault\"
  filters: Filter[];        // Lookup filters (unique identifier)
  field: string;            // Property to read
  snapshot?: 'current' | 'window_start';  // Default: 'current'
}
```

**Example: User's supply position at start of window**
```json
{
  \"type\": \"state\",
  \"entity_type\": \"Position\",
  \"filters\": [
    {\"field\": \"user\", \"op\": \"eq\", \"value\": \"0x123\"},
    {\"field\": \"market_id\", \"op\": \"eq\", \"value\": \"0xabc\"}
  ],
  \"field\": \"supply_assets\",
  \"snapshot\": \"window_start\"
}
```

### 2.5 Expression (Composable Math)

Combine values with math operations:

```typescript
type MathOp = 'add' | 'sub' | 'mul' | 'div';

interface BinaryExpression {
  type: 'expression';
  operator: MathOp;
  left: ExpressionNode;
  right: ExpressionNode;
}

interface Constant {
  type: 'constant';
  value: number;
}

// Recursive union
type ExpressionNode = EventRef | StateRef | BinaryExpression | Constant;
```

### 2.6 Condition

Compare two expressions to determine if signal triggers:

```typescript
type ComparisonOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

interface Condition {
  type: 'condition';
  left: ExpressionNode;
  operator: ComparisonOp;
  right: ExpressionNode;
}

---

## 3. Envio Data Source & Aggregations

Flare relies on Envio's GraphQL API (powered by Hasura). 

### 3.1 Aggregate Query Naming
In Envio, aggregate queries follow the pattern:
- **Events:** `{EventName}_aggregate` (e.g., `Morpho_Supply_aggregate`)
- **Entities:** `{EntityName}_aggregate` (e.g., `Position_aggregate`)

The query structure looks like this:
```graphql
query GetSum {
  Morpho_Supply_aggregate(where: { ... }) {
    aggregate {
      sum {
        assets
      }
      count
    }
  }
}
```

### 3.2 Enabling Aggregates
**Important:** Envio disables runtime aggregates on their **hosted service** by default to prevent performance \"foot-guns.\" 

- **Local/Self-Hosted:** Aggregates are enabled by default via Hasura.
- **Hosted Envio:** We must maintain pre-calculated rollups or contact the Envio team to evaluate enabling specific runtime aggregates for our project. 

For the Flare MVP, we assume aggregates are available (local/self-hosted) or use them strategically on indexed fields to minimize impact.

---

## 4. Signal Definition

A complete signal combines:
- **Scope**: Which chains to monitor
- **Window**: Time frame for evaluation
- **Condition**: When to trigger
- **Delivery**: Where to send notifications

```typescript
interface Signal {
  id?: string;
  name: string;
  description?: string;
  
  // Scope
  chains: number[];           // [1, 8453] = Ethereum + Base
  
  // Time window
  window: {
    duration: string;         // \"1h\", \"7d\", \"30m\"
  };
  
  // Trigger condition
  condition: Condition;
  
  // Multiple conditions (optional)
  conditions?: Condition[];
  logic?: 'AND' | 'OR';       // Default: AND
  
  // Delivery
  webhook_url: string;
  cooldown_minutes?: number;  // Default: 5
  
  // State
  is_active?: boolean;
}
```

---

## 5. Complete Examples

### Example 1: Net Supply Drop Alert

> \"Alert when net supply (supply - withdraw) drops below 20% of starting position\"

```json
{
  \"name\": \"Net Supply Drop Alert\",
  \"chains\": [1],
  \"window\": {\"duration\": \"7d\"},
  \"condition\": {
    \"type\": \"condition\",
    \"operator\": \"lt\",
    \"left\": {
      \"type\": \"expression\",
      \"operator\": \"sub\",
      \"left\": {
        \"type\": \"event\",
        \"event_type\": \"Supply\",
        \"filters\": [{\"field\": \"user\", \"op\": \"eq\", \"value\": \"0x123\"}],
        \"field\": \"assets\",
        \"aggregation\": \"sum\"
      },
      \"right\": {
        \"type\": \"event\",
        \"event_type\": \"Withdraw\",\n        \"filters\": [{\"field\": \"user\", \"op\": \"eq\", \"value\": \"0x123\"}],
        \"field\": \"assets\",
        \"aggregation\": \"sum\"
      }
    },
    \"right\": {
      \"type\": \"expression\",
      \"operator\": \"mul\",
      \"left\": {\"type\": \"constant\", \"value\": 0.2},
      \"right\": {
        \"type\": \"state\",
        \"entity_type\": \"Position\",
        \"filters\": [{\"field\": \"user\", \"op\": \"eq\", \"value\": \"0x123\"}],
        \"field\": \"supply_assets\",
        \"snapshot\": \"window_start\"
      }
    }
  },
  \"webhook_url\": \"https://hooks.example.com/alert\"
}
```

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         FLARE                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   REST API   │    │  EVALUATOR   │    │   WORKER     │  │
│  │   (CRUD +    │    │  (Expression │    │  (Scheduler  │  │
│  │   Simulate)  │    │   Engine)    │    │   + Notify)  │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         └───────────────────┴───────────────────┘           │
│                             │                               │
│                    ┌────────▼────────┐                      │
│                    │  PostgreSQL     │                      │
│                    │  (signals,      │                      │
│                    │   snapshots)    │                      │
│                    └────────┬────────┘                      │
│                             │                               │
└─────────────────────────────┼───────────────────────────────┘
                              │ GraphQL
                    ┌─────────▼─────────┐
                    │  ENVIO INDEXER    │
                    │  (Events + State) │
                    │  7 chains         │
                    └───────────────────┘
```

---

## 7. Next Steps

1. **Discuss this design** — any concerns or changes needed?
2. **Phase 1 Implementation** — complete core evaluation loop.
3. **Phase 2 Implementation** — worker + delivery logic.

---\n\n*Last Updated: 2026-02-03 v2.1 (Added Envio Aggregates info)*
