# API Reference

This document owns the HTTP surface. Signal syntax belongs in [DSL.md](./DSL.md). Auth rules belong in [AUTH.md](./AUTH.md).

## Base URLs

- main API root: `http://localhost:3000`
- main API namespace: `http://localhost:3000/api/v1`
- delivery service: `http://localhost:3100`

## Auth Summary

- `GET /health` is public
- `POST /api/v1/auth/register` is public unless `REGISTER_ADMIN_KEY` is configured
- all other `/api/v1/*` routes require `X-API-Key`
- `POST /webhook/deliver` requires `X-Sentinel-Signature`

See [AUTH.md](./AUTH.md) for the full auth model.

## Endpoint Inventory

### Main API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| POST | `/api/v1/auth/register` | Create Sentinel user + API key |
| POST | `/api/v1/signals` | Create signal |
| GET | `/api/v1/signals` | List user signals |
| GET | `/api/v1/signals/:id` | Get one signal |
| PATCH | `/api/v1/signals/:id` | Update signal |
| PATCH | `/api/v1/signals/:id/toggle` | Toggle `is_active` |
| DELETE | `/api/v1/signals/:id` | Delete signal |
| GET | `/api/v1/signals/:id/history` | Evaluation and notification history |
| POST | `/api/v1/simulate/:id/simulate` | Simulate across a time range |
| POST | `/api/v1/simulate/:id/first-trigger` | Find first trigger in a range |

### Delivery Service

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/link?token=...&app_user_id=...` | Hosted Telegram link page |
| POST | `/link/connect` | Link `app_user_id` to a Telegram chat |
| POST | `/webhook/deliver` | Receive Sentinel webhook and deliver to Telegram |
| GET | `/admin/stats` | Delivery stats |

## Register

```http
POST /api/v1/auth/register
Content-Type: application/json
```

Request body:

```json
{
  "name": "Acme Alerts",
  "key_name": "prod-key"
}
```

Both fields are optional but must be non-empty strings if provided.

Response:

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "api_key_id": "2e4d1e12-3a0d-4b0c-9b54-7a1f4d8c3ed1",
  "api_key": "sentinel_..."
}
```

## Create Signal

```http
POST /api/v1/signals
Content-Type: application/json
X-API-Key: sentinel_...
```

Request body:

```json
{
  "name": "High Utilization",
  "description": "Optional",
  "definition": { "...": "see DSL.md" },
  "webhook_url": "https://your-webhook.example/alert",
  "cooldown_minutes": 5
}
```

Use [DSL.md](./DSL.md) for the canonical condition and metric reference.

## Signal CRUD

List:

```http
GET /api/v1/signals?active=true
X-API-Key: sentinel_...
```

Get one:

```http
GET /api/v1/signals/:id
X-API-Key: sentinel_...
```

Partial update:

```http
PATCH /api/v1/signals/:id
Content-Type: application/json
X-API-Key: sentinel_...

{
  "cooldown_minutes": 10,
  "is_active": false
}
```

Toggle:

```http
PATCH /api/v1/signals/:id/toggle
X-API-Key: sentinel_...
```

Delete:

```http
DELETE /api/v1/signals/:id
X-API-Key: sentinel_...
```

## History

```http
GET /api/v1/signals/:id/history?limit=100&include_notifications=true
X-API-Key: sentinel_...
```

Response shape:

```json
{
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "evaluations": [],
  "notifications": [],
  "count": {
    "evaluations": 0,
    "notifications": 0
  }
}
```

## Simulation

Simulate across a time range:

```http
POST /api/v1/simulate/:id/simulate
Content-Type: application/json
X-API-Key: sentinel_...

{
  "start_time": "2026-01-01T00:00:00Z",
  "end_time": "2026-02-01T00:00:00Z",
  "interval_ms": 3600000,
  "compact": true
}
```

Find first trigger:

```http
POST /api/v1/simulate/:id/first-trigger
Content-Type: application/json
X-API-Key: sentinel_...

{
  "start_time": "2026-01-01T00:00:00Z",
  "end_time": "2026-02-01T00:00:00Z",
  "precision_ms": 60000
}
```

## Webhook Payload

Outgoing Sentinel webhooks use this payload shape:

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
  "context": {
    "app_user_id": "550e8400-e29b-41d4-a716-446655440000",
    "address": "0x...",
    "market_id": "0x...",
    "chain_id": 1
  }
}
```

For direct Telegram delivery, `context.app_user_id` should match the Telegram link mapping. See [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md).

## Delivery Notes

If you are using the delivery service:

- local worker-to-delivery target: `http://delivery:3100/webhook/deliver`
- production target: your public delivery URL

Do not use `localhost` as the worker webhook target unless the worker is actually running on the host instead of in Docker.

## Related Docs

- Signal syntax and examples: [DSL.md](./DSL.md)
- Auth rules: [AUTH.md](./AUTH.md)
- Telegram delivery contract: [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md)
- Local setup and curl smoke tests: [GETTING_STARTED.md](./GETTING_STARTED.md)
