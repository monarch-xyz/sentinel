# 🎯 Monarch Signal Service - Design Doc

> **Project:** Signal Service (codename: "Watchfire")
> **Author:** Stark
> **Date:** 2026-02-02
> **Status:** RFC / Design Discussion

---

## Executive Summary

A monitoring service that lets users define complex, multi-condition signals on DeFi data and receive notifications when conditions are met. Built on our existing Envio indexer, designed for extensibility and performance.

**Key Differentiators from TellTide:**
- Uses Envio (GraphQL) instead of SQD — single unified data source
- Supports complex multi-entity conditions (multiple addresses, markets)
- Simulation/backtesting built-in
- Cleaner separation of concerns
- Designed for extensibility to other protocols

---

## 1. Problem Statement

Users want to track complex on-chain conditions like:
- "3 of 5 whale addresses reduce their supply position by 10%+ each, AND total market TVL drops 20%, within 7 days"
- "Any liquidation above $50k in markets I'm watching, aggregating value of 5% of total supply"
- "Net borrow rate across my markets exceeds 15% APY for 1 hour"

Current Product limitations:
- Simple single-condition logic
	- Either monitor single "state" or single "event" with threashold
- No simulation/backtest capability
- Tightly coupled architecture

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     SIGNAL SERVICE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   REST API   │    │  EVALUATOR   │    │   WORKER     │  │
│  │   (CRUD +    │    │  (Signal     │    │  (Scheduler  │  │
│  │   Simulate)  │    │   Engine)    │    │   + Notify)  │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         └───────────────────┴───────────────────┘           │
│                             │                               │
│                    ┌────────▼────────┐                      │
│                    │  PostgreSQL     │                      │
│                    │  (signals,      │                      │
│                    │   state, logs)  │                      │
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

## 3. Data Model

### 3.1 Signal Definition

```typescript
interface Signal {
  id: string;                    // UUID
  user_id: string;               // Owner
  name: string;                  // Human-readable name
  description?: string;          // Optional description
  
  // The signal definition
  definition: SignalDefinition;
  
  // Delivery
  webhook_url: string;
  cooldown_minutes: number;      // Default: 5
  
  // State
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_triggered_at?: Date;
  last_evaluated_at?: Date;
}
```

### 3.2 Signal Definition (DSL)

**Design Philosophy:** 
- JSON-based for API consumption, easy to validate
- Expression-based for complex conditions
- Composable primitives

```typescript
interface SignalDefinition {
  // Target scope
  scope: SignalScope;
  
  // Conditions (AND by default)
  conditions: Condition[];
  
  // How conditions combine
  logic?: 'AND' | 'OR';          // Default: AND
  
  // Time window for evaluation
  window: TimeWindow;
}

interface SignalScope {
  chains: number[];              // [1, 8453] = Ethereum + Base
  markets?: string[];            // Market IDs to watch
  addresses?: string[];          // Addresses to track (optional)
  protocol?: 'morpho' | 'all';   // Future: extensible
}

interface TimeWindow {
  duration: string;              // "1h", "7d", "30m"
  lookback_blocks?: number;      // Optional: override with blocks
}
```

### 3.3 Conditions

**Condition Types:**

```typescript
type Condition = 
  | ThresholdCondition
  | ChangeCondition
  | GroupCondition
  | AggregateCondition;

// Simple threshold: "value > X"
interface ThresholdCondition {
  type: 'threshold';
  metric: MetricType;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
  
  // Optional filters
  market_id?: string;
  address?: string;
}

// Change detection: "value changed by X%"
interface ChangeCondition {
  type: 'change';
  metric: MetricType;
  direction: 'increase' | 'decrease' | 'any';
  by: { percent: number } | { absolute: number };
  
  // Optional filters
  market_id?: string;
  address?: string;
}

// Group condition: "N of M addresses meet condition"
interface GroupCondition {
  type: 'group';
  addresses: string[];           // Watch these addresses
  requirement: {
    count: number;               // At least N
    of: number;                  // of M total (validation)
  };
  condition: Condition;          // Each must meet this
}

// Aggregate across scope: "total/avg/sum across markets"
interface AggregateCondition {
  type: 'aggregate';
  aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count';
  metric: MetricType;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
}
```

### 3.4 Metrics

```typescript
type MetricType =
  // Position metrics (per address per market)
  | 'supply_assets'
  | 'supply_shares'
  | 'borrow_assets'
  | 'borrow_shares'
  | 'collateral_assets'
  
  // Market metrics (aggregate)
  | 'market_total_supply'
  | 'market_total_borrow'
  | 'market_utilization'
  | 'market_borrow_rate'
  
  // Event-based (flow)
  | 'net_supply_flow'           // supply - withdraw
  | 'net_borrow_flow'           // borrow - repay
  | 'liquidation_volume'
  | 'event_count';
```

---

## 4. Example Signals

### Example 1: Whale Position Reduction
*"3 of 5 whales reduce supply by 10%+ in market X over 7 days"*

```json
{
  "name": "Whale Exodus Alert",
  "definition": {
    "scope": {
      "chains": [1],
      "markets": ["0x58e212..."]
    },
    "window": { "duration": "7d" },
    "conditions": [
      {
        "type": "group",
        "addresses": [
          "0xwhale1...",
          "0xwhale2...",
          "0xwhale3...",
          "0xwhale4...",
          "0xwhale5..."
        ],
        "requirement": { "count": 3, "of": 5 },
        "condition": {
          "type": "change",
          "metric": "supply_assets",
          "direction": "decrease",
          "by": { "percent": 10 }
        }
      }
    ]
  }
}
```

### Example 2: Market TVL Drop + Utilization Spike
*"Total supply drops 20% AND utilization exceeds 95%"*

```json
{
  "name": "Liquidity Crisis Alert",
  "definition": {
    "scope": {
      "chains": [1, 8453],
      "markets": ["0xmarket1...", "0xmarket2..."]
    },
    "window": { "duration": "1h" },
    "logic": "AND",
    "conditions": [
      {
        "type": "change",
        "metric": "market_total_supply",
        "direction": "decrease",
        "by": { "percent": 20 }
      },
      {
        "type": "threshold",
        "metric": "market_utilization",
        "operator": ">",
        "value": 0.95
      }
    ]
  }
}
```

### Example 3: Net Flow Alert
*"Net withdrawals exceed $1M in any watched market"*

```json
{
  "name": "Large Net Withdrawal",
  "definition": {
    "scope": {
      "chains": [1],
      "markets": ["0xmarket1...", "0xmarket2...", "0xmarket3..."]
    },
    "window": { "duration": "2h" },
    "conditions": [
      {
        "type": "aggregate",
        "aggregation": "sum",
        "metric": "net_supply_flow",
        "operator": "<",
        "value": -1000000000000
      }
    ]
  }
}
```

---

## 5. Evaluation Engine

### 5.1 Design Principles

1. **Lazy evaluation** — Only query data needed for active signals
2. **Caching** — Cache position snapshots, invalidate on new events
3. **Batching** — Group signals by scope, share queries
4. **Incremental** — Track state between evaluations

### 5.2 Evaluation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    EVALUATION CYCLE                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Load Active Signals                                     │
│     ↓                                                       │
│  2. Group by Scope (batch similar queries)                  │
│     ↓                                                       │
│  3. For each group:                                         │
│     a. Fetch current state (Position, Market entities)      │
│     b. Fetch event history if needed (flow metrics)         │
│     c. Load previous snapshot (for change detection)        │
│     ↓                                                       │
│  4. Evaluate conditions:                                    │
│     - Threshold: compare value to threshold                 │
│     - Change: compare current vs snapshot                   │
│     - Group: evaluate sub-condition per address             │
│     - Aggregate: reduce values, compare                     │
│     ↓                                                       │
│  5. Combine conditions (AND/OR logic)                       │
│     ↓                                                       │
│  6. If triggered:                                           │
│     a. Check cooldown                                       │
│     b. Send webhook                                         │
│     c. Log notification                                     │
│     d. Update last_triggered_at                             │
│     ↓                                                       │
│  7. Save current snapshot for next cycle                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Querying Envio

```typescript
// Example: Get positions for addresses in scope
const POSITIONS_QUERY = gql`
  query GetPositions($chainId: Int!, $marketId: String!, $users: [String!]!) {
    Position(
      where: {
        chainId: { _eq: $chainId }
        marketId: { _eq: $marketId }
        user: { _in: $users }
      }
    ) {
      user
      supplyShares
      borrowShares
      collateral
      market {
        totalSupplyAssets
        totalBorrowAssets
        lastUpdate
      }
    }
  }
`;

// Example: Get events for flow calculation
const EVENTS_QUERY = gql`
  query GetSupplyEvents($chainId: Int!, $marketId: String!, $since: BigInt!) {
    Morpho_Supply(
      where: {
        chainId: { _eq: $chainId }
        market_id: { _eq: $marketId }
        timestamp: { _gte: $since }
      }
    ) {
      onBehalf
      assets
      timestamp
    }
    Morpho_Withdraw(
      where: {
        chainId: { _eq: $chainId }
        market_id: { _eq: $marketId }
        timestamp: { _gte: $since }
      }
    ) {
      onBehalf
      assets
      timestamp
    }
  }
`;
```

---

## 6. API Design

### 6.1 Endpoints

```
POST   /api/v1/signals              Create signal
GET    /api/v1/signals              List signals (filter by user_id)
GET    /api/v1/signals/:id          Get signal details
PATCH  /api/v1/signals/:id          Update signal
DELETE /api/v1/signals/:id          Delete signal

POST   /api/v1/signals/:id/simulate Simulate signal on historical data
GET    /api/v1/signals/:id/logs     Get trigger history

GET    /api/v1/health               Health check
GET    /api/v1/metrics              Prometheus metrics
```

### 6.2 Simulation Endpoint

```typescript
// POST /api/v1/signals/:id/simulate
interface SimulateRequest {
  start_time: string;            // ISO 8601
  end_time: string;
  // Optional: use definition from request body instead of saved signal
  definition?: SignalDefinition;
}

interface SimulateResponse {
  signal_id: string;
  simulation_range: {
    start: string;
    end: string;
  };
  triggers: Array<{
    timestamp: string;
    conditions_met: string[];    // Which conditions triggered
    values: Record<string, number>;
  }>;
  summary: {
    total_triggers: number;
    would_have_notified: number; // After cooldown
  };
}
```

### 6.3 Webhook Payload

```json
{
  "signal_id": "uuid",
  "signal_name": "Whale Exodus Alert",
  "triggered_at": "2026-02-02T15:30:00Z",
  "scope": {
    "chains": [1],
    "markets": ["0x58e212..."]
  },
  "conditions_met": [
    {
      "type": "group",
      "description": "3 of 5 addresses reduced supply by 10%+",
      "details": {
        "addresses_triggered": ["0xwhale1", "0xwhale2", "0xwhale3"],
        "changes": [
          { "address": "0xwhale1", "change_percent": -15.2 },
          { "address": "0xwhale2", "change_percent": -12.8 },
          { "address": "0xwhale3", "change_percent": -10.1 }
        ]
      }
    }
  ],
  "context": {
    "market_total_supply": "50000000000000",
    "market_utilization": 0.82
  }
}
```

---

## 7. Project Structure

```
signal-service/
├── src/
│   ├── api/                    # REST API
│   │   ├── routes/
│   │   │   ├── signals.ts
│   │   │   ├── simulate.ts
│   │   │   └── health.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   └── validate.ts
│   │   └── index.ts
│   │
│   ├── engine/                 # Signal evaluation
│   │   ├── evaluator.ts        # Main evaluation logic
│   │   ├── conditions/         # Condition implementations
│   │   │   ├── threshold.ts
│   │   │   ├── change.ts
│   │   │   ├── group.ts
│   │   │   └── aggregate.ts
│   │   ├── metrics/            # Metric fetchers
│   │   │   ├── position.ts
│   │   │   ├── market.ts
│   │   │   └── flow.ts
│   │   └── cache.ts            # Snapshot caching
│   │
│   ├── worker/                 # Background processing
│   │   ├── scheduler.ts        # Cron scheduling
│   │   ├── evaluator-worker.ts
│   │   └── notifier.ts         # Webhook dispatch
│   │
│   ├── db/                     # Database layer
│   │   ├── schema.ts
│   │   ├── repositories/
│   │   │   ├── signals.ts
│   │   │   ├── snapshots.ts
│   │   │   └── notifications.ts
│   │   └── migrations/
│   │
│   ├── envio/                  # Envio client
│   │   ├── client.ts
│   │   └── queries/
│   │       ├── positions.ts
│   │       ├── markets.ts
│   │       └── events.ts
│   │
│   ├── types/                  # TypeScript types
│   │   ├── signal.ts
│   │   ├── condition.ts
│   │   └── webhook.ts
│   │
│   └── config/
│       └── index.ts
│
├── tests/
│   ├── unit/
│   │   ├── engine/
│   │   └── api/
│   ├── integration/
│   └── fixtures/
│
├── docs/
│   ├── API.md
│   └── DSL.md
│
├── docker-compose.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## 8. Database Schema

```sql
-- Signals table
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  definition JSONB NOT NULL,
  webhook_url TEXT NOT NULL,
  cooldown_minutes INT DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_triggered_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ
);

CREATE INDEX idx_signals_user ON signals(user_id);
CREATE INDEX idx_signals_active ON signals(is_active) WHERE is_active = true;

-- Snapshots (for change detection)
CREATE TABLE signal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,  -- Captured state for comparison
  UNIQUE(signal_id)     -- Only keep latest snapshot per signal
);

-- Notification log
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  webhook_status INT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_signal ON notification_log(signal_id);
CREATE INDEX idx_notifications_time ON notification_log(triggered_at DESC);
```

---

## Webhook Dispatcher & Abstraction

**Everything is a webhook.** To support different channels (Telegram, Discord, etc.), Flare uses a "tunnel" approach:
1. Flare evaluates a signal and triggers a generic HTTP POST webhook.
2. For internal notifications (like our Telegram bot), we point Flare to an internal **Notification Tunnel** service.
3. This keeps Flare lean—it doesn't care about Telegram APIs, just valid JSON over HTTP.

```
[Flare] ──▶ [Internal Tunnel] ──▶ [Telegram API]
         └─▶ [Customer Webhook]
```


| Aspect | Envio | SQD |
|--------|-------|-----|
| **Integration** | Already have indexer | New indexer needed |
| **Maintenance** | Single data source | Duplicate indexing |
| **State Access** | Full Position/Market state | Events only |
| **Query Style** | GraphQL (flexible) | Custom streaming |
| **Consistency** | Same data as FE | Potentially different |

**Decision:** Use Envio. Less complexity, single source of truth.

### 9.2 Why JSON DSL over Expression Language?

| Approach | Pros | Cons |
|----------|------|------|
| **JSON DSL** | Type-safe, easy to validate, API-friendly | Verbose |
| **Expression String** | Compact, powerful | Parsing complexity, security |
| **Visual Builder** | User-friendly | FE complexity |

**Decision:** Start with JSON DSL for API, add expression parser later for power users.

### 9.3 Polling vs Event-Driven

| Approach | Pros | Cons |
|----------|------|------|
| **Polling** | Simple, predictable, rate-limited | Delay (30s-1m) |
| **Event-Driven** | Real-time | Complex, higher load |

**Decision:** Start with polling (30s interval). Real-time can be added later for premium users.

### 9.4 Simulation Architecture

**Option A:** Reuse live evaluator with historical data
- Pros: Single code path
- Cons: May need to mock time-dependent logic

**Option B:** Separate simulation engine
- Pros: Clean separation
- Cons: Code duplication

**Decision:** Option A — parameterize evaluator with time range, reuse condition logic.

---

## 10. Implementation Phases

### Phase 1: Core (Week 1-2)
- [ ] Project scaffold + DB schema
- [ ] Signal CRUD API
- [ ] Basic condition types (threshold, change)
- [ ] Single-market evaluation
- [ ] Webhook dispatch
- [ ] Unit tests

### Phase 2: Complex Conditions (Week 3)
- [ ] Group conditions (N of M)
- [ ] Aggregate conditions
- [ ] Multi-market scope
- [ ] Flow metrics (net supply/borrow)

### Phase 3: Simulation (Week 4)
- [ ] Simulation endpoint
- [ ] Historical data fetching
- [ ] Backtest UI integration (basic)

### Phase 4: Production Hardening (Week 5)
- [ ] Rate limiting
- [ ] Monitoring (Prometheus)
- [ ] Error handling + retry
- [ ] Documentation
- [ ] Load testing

### Future (Post-MVP)
- [ ] Expression language parser
- [ ] Real-time evaluation (WebSocket)
- [ ] Multi-protocol support
- [ ] Signal templates/sharing

---

## 11. Open Questions

1. **Authentication:** Use API keys (like data-api) or integrate with Monarch auth?
   - Leaning: API keys for simplicity, Monarch auth for FE integration

2. **Notification Channels:** Start with webhook only, or add Telegram/Discord?
   - Leaning: Webhook first, add Telegram in Phase 2 (TellTide already has this)

3. **Signal Limits:** How many signals per user?
   - Suggestion: 10 free, more for paid users

4. **Indexer Load:** Will high signal volume overload Envio?
   - Mitigation: Query batching, caching, rate limiting

5. **FE Integration:** Build in Monarch FE or separate dashboard?
   - Suggestion: Separate first (like TellTide), integrate later

---

## 12. Next Steps

1. **Discuss this design** — any concerns or changes needed?
2. **Create repo** — `monarch-xyz/signal-service` or `monarch-xyz/watchfire`
3. **Scaffold project** — follow structure above
4. **Start Phase 1** — focus on core evaluation loop

---

*Let's discuss! 🚀*
