# Flare API Reference

> REST API for managing signals and running simulations.

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** All endpoints require `X-API-Key` header.

---

## Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/signals` | Create a new signal |
| GET | `/signals` | List all signals |
| GET | `/signals/:id` | Get signal details |
| PATCH | `/signals/:id` | Update a signal |
| DELETE | `/signals/:id` | Delete a signal |
| POST | `/signals/:id/simulate` | Run simulation |
| GET | `/signals/:id/logs` | Get trigger history |
| GET | `/health` | Health check |

---

## Signals

### Create Signal

```http
POST /api/v1/signals
Content-Type: application/json
X-API-Key: your-api-key

{
  "name": "My Alert",
  "description": "Optional description",
  "definition": {
    "scope": {
      "chains": [1],
      "markets": ["0x..."]
    },
    "window": { "duration": "1h" },
    "conditions": [
      {
        "type": "threshold",
        "metric": "Morpho.Market.utilization",
        "operator": ">",
        "value": 0.9
      }
    ]
  },
  "webhook_url": "https://your-webhook.com/alert",
  "cooldown_minutes": 5
}
```

**Response:**
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

### List Signals

```http
GET /api/v1/signals
X-API-Key: your-api-key
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `user_id` | string | Filter by user |
| `is_active` | boolean | Filter by active status |
| `limit` | number | Max results (default: 50) |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "signals": [...],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### Get Signal

```http
GET /api/v1/signals/:id
X-API-Key: your-api-key
```

**Response:** Full signal object.

### Update Signal

```http
PATCH /api/v1/signals/:id
Content-Type: application/json
X-API-Key: your-api-key

{
  "is_active": false,
  "cooldown_minutes": 10
}
```

**Updatable fields:**
- `name`
- `description`
- `definition`
- `webhook_url`
- `cooldown_minutes`
- `is_active`

**Response:** Updated signal object.

### Delete Signal

```http
DELETE /api/v1/signals/:id
X-API-Key: your-api-key
```

**Response:**
```json
{
  "deleted": true,
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## Simulation

### Run Simulation

Backtest a signal against historical data.

```http
POST /api/v1/signals/:id/simulate
Content-Type: application/json
X-API-Key: your-api-key

{
  "start_time": "2026-01-01T00:00:00Z",
  "end_time": "2026-02-01T00:00:00Z"
}
```

**Optional:** Override the saved signal definition:
```json
{
  "start_time": "2026-01-01T00:00:00Z",
  "end_time": "2026-02-01T00:00:00Z",
  "definition": {
    "scope": { "chains": [1] },
    "window": { "duration": "1h" },
    "conditions": [...]
  }
}
```

**Response:**
```json
{
  "signal_id": "550e8400-...",
  "simulation_range": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-02-01T00:00:00Z"
  },
  "triggers": [
    {
      "timestamp": "2026-01-15T10:30:00Z",
      "conditions_met": ["threshold:Morpho.Market.utilization"],
      "values": {
        "Morpho.Market.utilization": 0.94
      }
    },
    {
      "timestamp": "2026-01-22T14:00:00Z",
      "conditions_met": ["threshold:Morpho.Market.utilization"],
      "values": {
        "Morpho.Market.utilization": 0.97
      }
    }
  ],
  "summary": {
    "total_triggers": 2,
    "would_have_notified": 2
  }
}
```

---

## Logs

### Get Trigger History

```http
GET /api/v1/signals/:id/logs
X-API-Key: your-api-key
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Max results (default: 50) |
| `offset` | number | Pagination offset |
| `since` | string | ISO 8601 timestamp |

**Response:**
```json
{
  "logs": [
    {
      "id": "log-uuid",
      "signal_id": "signal-uuid",
      "triggered_at": "2026-02-02T10:30:00Z",
      "conditions_met": ["threshold:Morpho.Market.utilization"],
      "values": { "Morpho.Market.utilization": 0.94 },
      "webhook_status": 200,
      "webhook_response_time_ms": 150
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

---

## Health

### Health Check

```http
GET /api/v1/health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "components": {
    "database": "connected",
    "envio": "connected",
    "worker": "running"
  },
  "uptime_seconds": 86400
}
```

---

## Webhook Payload

When a signal triggers, Flare sends a POST request to your webhook URL:

```json
{
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "signal_name": "My Alert",
  "triggered_at": "2026-02-02T15:30:00Z",
  "scope": {
    "chains": [1],
    "markets": ["0x58e212..."]
  },
  "conditions_met": [
    {
      "type": "threshold",
      "metric": "Morpho.Market.utilization",
      "description": "Morpho.Market.utilization > 0.9",
      "actual_value": 0.94,
      "threshold": 0.9
    }
  ],
  "context": {
    "Morpho.Market.totalSupplyAssets": "50000000000000000000000",
    "Morpho.Market.totalBorrowAssets": "47000000000000000000000",
    "Morpho.Market.utilization": 0.94
  }
}
```

**Webhook Behavior:**
- Timeout: 10 seconds
- Retries: 3 attempts with exponential backoff
- Expected response: 2xx status code

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid signal definition",
    "details": [
      { "field": "definition.conditions", "message": "must not be empty" }
    ]
  }
}
```

**Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Signal not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Create/Update | 60/min |
| List/Get | 300/min |
| Simulate | 10/min |

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 55
X-RateLimit-Reset: 1706886000
```
