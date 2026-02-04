# Flare API Reference

REST API for managing signals and running simulations.

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** API keys required for all endpoints except `/auth/register` and `/health`.

Send `X-API-Key: <your_key>` in every request.

---

**Endpoints**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/signals` | Create a new signal |
| GET | `/signals` | List all signals |
| GET | `/signals/:id` | Get signal details |
| PATCH | `/signals/:id` | Update a signal |
| PATCH | `/signals/:id/toggle` | Toggle `is_active` |
| DELETE | `/signals/:id` | Delete a signal |
| POST | `/simulate/:id/simulate` | Run simulation |
| POST | `/simulate/:id/first-trigger` | Find first trigger in a range |
| GET | `/health` | Health check |
| POST | `/auth/register` | Create a user + API key |

---

**DSL Overview**

A signal is a JSON object with this shape:

```json
{
  "scope": {
    "chains": [1],
    "markets": ["0x..."],
    "addresses": ["0x..."]
  },
  "window": { "duration": "1h" },
  "logic": "AND",
  "conditions": [
    { "type": "threshold", "metric": "Morpho.Market.utilization", "operator": ">", "value": 0.9 }
  ]
}
```

**Scope**

- `chains` is required.
- `markets` and `addresses` are optional.
- If a condition omits `chain_id`, `market_id`, or `address`, the compiler will try to infer it from scope.
- If scope contains multiple values, you must specify the field in the condition (to avoid ambiguity).

**Window**

- `duration` uses `{number}{unit}` where unit is `s`, `m`, `h`, `d`, or `w`.
- Example values: `30m`, `1h`, `7d`.

**Condition Types**

**`threshold`**
- Compare a metric to a value.
- Requires `chain_id`.
- Requires `market_id` for Market and Position metrics.
- Requires `address` for Position metrics.

**`change`**
- Compare current vs past value of a metric.
- Same filter requirements as `threshold`.
- `direction` must be `increase` or `decrease` (not `any`).

**`group`**
- Evaluate a condition per address, then apply an N-of-M requirement.
- `requirement.of` must equal the number of `addresses`.
- Inner condition must NOT include `address` (it is injected per address).
- Nested `group` or `aggregate` is not supported.

**`aggregate`**
- Aggregate a metric across scope.
- For Market metrics, `scope.markets` or `market_id` is required.
- For Position metrics, both `scope.markets` and `scope.addresses` are required.
- For Event metrics, `scope.addresses` and `scope.markets` are optional.

**Metrics**

Metrics are qualified names. The current registry lives in `src/engine/metrics.ts`.

Common examples:
- `Morpho.Market.totalSupplyAssets`
- `Morpho.Market.totalBorrowAssets`
- `Morpho.Market.utilization` (computed)
- `Morpho.Position.supplyShares`
- `Morpho.Event.Supply.assets`
- `Morpho.Event.Supply.count` (event count metric)
- `Morpho.Flow.netSupply` (chained event: Supply - Withdraw)

**Event Filters (advanced)**

You can add `filters` to event-based conditions (`threshold` or `aggregate`) to match specific event fields, for example `caller`, `isMonarch`, `txHash`.

Rules:
- Only supported for event metrics (including chained events like `Morpho.Flow.netSupply`).
- Do not use reserved fields: `chainId`, `marketId`, `market_id`, `user`, `onBehalf`, `timestamp`.

Example:

```json
{
  "type": "threshold",
  "metric": "Morpho.Event.Supply.assets",
  "operator": ">",
  "value": 1000,
  "chain_id": 1,
  "market_id": "0xM",
  "filters": [
    { "field": "caller", "op": "eq", "value": "0xC" },
    { "field": "isMonarch", "op": "eq", "value": true }
  ]
}
```

---

**Examples**

**1. Simple threshold**

```json
{
  "scope": { "chains": [1], "markets": ["0xM"] },
  "window": { "duration": "1h" },
  "conditions": [
    {
      "type": "threshold",
      "metric": "Morpho.Market.utilization",
      "operator": ">",
      "value": 0.9
    }
  ]
}
```

**2. Change condition (position drop)**

```json
{
  "scope": { "chains": [1], "markets": ["0xM"], "addresses": ["0xA"] },
  "window": { "duration": "24h" },
  "conditions": [
    {
      "type": "change",
      "metric": "Morpho.Position.supplyShares",
      "direction": "decrease",
      "by": { "percent": 20 }
    }
  ]
}
```

**3. Group condition (2 of 3 whales exit)**

```json
{
  "scope": { "chains": [1], "markets": ["0xM"] },
  "window": { "duration": "6h" },
  "conditions": [
    {
      "type": "group",
      "addresses": ["0xA", "0xB", "0xC"],
      "requirement": { "count": 2, "of": 3 },
      "condition": {
        "type": "change",
        "metric": "Morpho.Position.supplyShares",
        "direction": "decrease",
        "by": { "percent": 30 },
        "market_id": "0xM",
        "chain_id": 1
      }
    }
  ]
}
```

**4. Aggregate event burst (count + size)**

```json
{
  "scope": { "chains": [1], "markets": ["0xM"], "addresses": ["0xA", "0xB", "0xC"] },
  "window": { "duration": "6h" },
  "logic": "AND",
  "conditions": [
    {
      "type": "aggregate",
      "aggregation": "sum",
      "metric": "Morpho.Event.Supply.count",
      "operator": ">",
      "value": 25,
      "chain_id": 1,
      "market_id": "0xM"
    },
    {
      "type": "aggregate",
      "aggregation": "sum",
      "metric": "Morpho.Event.Supply.assets",
      "operator": ">",
      "value": 1000000,
      "chain_id": 1,
      "market_id": "0xM"
    }
  ]
}
```

---

**Create Signal**

```http
POST /api/v1/signals
Content-Type: application/json
X-API-Key: your-api-key

{
  "name": "My Alert",
  "description": "Optional description",
  "definition": { ... },
  "webhook_url": "https://your-webhook.com/alert",
  "cooldown_minutes": 5
}
```

**Response**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My Alert",
  "description": "Optional description",
  "definition": { ... },
  "webhook_url": "https://your-webhook.com/alert",
  "cooldown_minutes": 5,
  "is_active": true,
  "created_at": "2026-02-02T15:30:00Z",
  "updated_at": "2026-02-02T15:30:00Z"
}
```

**List Signals**

```http
GET /api/v1/signals
X-API-Key: your-api-key
```

**Response**

```json
[
  {
    "id": "...",
    "name": "...",
    "definition": { ... },
    "webhook_url": "...",
    "cooldown_minutes": 5,
    "is_active": true,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

**Update Signal**

```http
PATCH /api/v1/signals/:id
Content-Type: application/json
X-API-Key: your-api-key

{
  "is_active": false,
  "cooldown_minutes": 10
}
```

**Toggle Active**

```http
PATCH /api/v1/signals/:id/toggle
X-API-Key: your-api-key
```

---

**Simulation**

```http
POST /api/v1/simulate/:id/simulate
Content-Type: application/json
X-API-Key: your-api-key

{
  "start_time": "2026-01-01T00:00:00Z",
  "end_time": "2026-02-01T00:00:00Z",
  "interval_ms": 3600000,
  "compact": false
}
```

**Response**

```json
{
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "range": { "start_time": "2026-01-01T00:00:00Z", "end_time": "2026-02-01T00:00:00Z" },
  "steps": 25,
  "triggers": [
    {
      "timestamp": "2026-01-01T00:00:00.000Z",
      "triggered": false,
      "operator": "gt",
      "left_value": 120,
      "right_value": 100,
      "window_start": "2025-12-31T23:00:00.000Z",
      "block_numbers": { "current": 19000000, "windowStart": 18999900 },
      "execution_ms": 42
    }
  ]
}
```

Note: `left_value`/`right_value`/`operator` are only present when the signal has a single simple condition.

Limits:
- Max steps: `MAX_SIMULATION_STEPS` (default 2000)
- Rate limit: `SIMULATE_RATE_LIMIT` requests/min per IP (default 60)

**Compact Response**

Set `compact: true` to return only trigger timestamps:

```json
{
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "range": { "start_time": "2026-01-01T00:00:00Z", "end_time": "2026-02-01T00:00:00Z" },
  "steps": 25,
  "triggered_count": 2,
  "triggered_timestamps": [
    "2026-01-15T10:30:00.000Z",
    "2026-01-22T14:00:00.000Z"
  ]
}
```

---

**Find First Trigger**

```http
POST /api/v1/simulate/:id/first-trigger
Content-Type: application/json
X-API-Key: your-api-key

{
  "start_time": "2026-01-01T00:00:00Z",
  "end_time": "2026-02-01T00:00:00Z",
  "precision_ms": 60000
}
```

**Response (not triggered)**

```json
{
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "triggered": false,
  "range": { "start_time": "2026-01-01T00:00:00Z", "end_time": "2026-02-01T00:00:00Z" }
}
```

**Response (triggered)**

```json
{
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "triggered": true,
  "first_triggered_at": "2026-01-15T10:30:00.000Z",
  "window_start": "2026-01-15T09:30:00.000Z",
  "operator": "gt",
  "left_value": 120,
  "right_value": 100,
  "block_numbers": { "current": 19000000, "windowStart": 18999900 },
  "execution_ms": 42
}
```

---

**Webhook Payload**

```json
{
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "signal_name": "My Alert",
  "triggered_at": "2026-02-02T15:30:00Z",
  "scope": {
    "chains": [1],
    "markets": ["0x..."],
    "addresses": ["0x..."]
  },
  "conditions_met": [],
  "context": {}
}
```

Webhook behavior:
- Timeout: 10 seconds
- Retries: up to `WEBHOOK_MAX_RETRIES` (default 3) with exponential backoff
- Expected response: 2xx
- Idempotency: `Idempotency-Key: <signal_id>:<triggered_at>`
- Signature: `X-Flare-Signature` and `X-Flare-Timestamp` (if `WEBHOOK_SECRET` is set). Signature is `sha256=HMAC(secret, "<timestamp>.<payload>")`.

---

**Error Responses**

Validation errors return:

```json
{
  "error": "Validation failed",
  "details": [
    { "path": ["definition", "conditions"], "message": "Required" }
  ]
}
```

Generic errors return:

```json
{ "error": "Internal server error" }
```

---

**Register**

Create a user and API key:

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "name": "Acme Alerts",
  "key_name": "prod-key",
  "payment_proof": "optional-for-future-x402"
}
```

**Response**

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "api_key_id": "2e4d1e12-3a0d-4b0c-9b54-7a1f4d8c3ed1",
  "api_key": "flare_..."
}
```
