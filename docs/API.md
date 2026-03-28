# API Reference

This document owns the HTTP surface. Signal syntax belongs in [DSL.md](./DSL.md). Auth rules belong in [AUTH.md](./AUTH.md).

## Base URLs

- main API root: `http://localhost:3000`
- main API namespace: `http://localhost:3000/api/v1`
- delivery service: `http://localhost:3100`

## Auth Summary

- `GET /health` is public
- `GET /ready` is public
- `POST /api/v1/auth/register` is public unless `REGISTER_ADMIN_KEY` is configured
- `POST /api/v1/auth/siwe/nonce` is public
- `POST /api/v1/auth/siwe/verify` is public
- all other `/api/v1/*` routes require either `X-API-Key` or a Sentinel session
- `POST /webhook/deliver` requires `X-Sentinel-Signature`
- delivery internal status/link routes require `X-Admin-Key`

See [AUTH.md](./AUTH.md) for the full auth model.

## Endpoint Inventory

### Main API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/ready` | Readiness check against DB, Redis, and configured providers |
| POST | `/api/v1/auth/register` | Create Sentinel owner + API key |
| POST | `/api/v1/auth/siwe/nonce` | Issue SIWE nonce |
| POST | `/api/v1/auth/siwe/verify` | Verify SIWE message and create session |
| GET | `/api/v1/auth/me` | Return authenticated profile |
| POST | `/api/v1/auth/logout` | Revoke the current session |
| GET | `/api/v1/me/integrations/telegram` | Return Telegram link status for the current user |
| POST | `/api/v1/me/integrations/telegram/link` | Link a Telegram token to the current user |
| POST | `/api/v1/signals` | Create signal |
| GET | `/api/v1/signals` | List user signals |
| GET | `/api/v1/signals/:id` | Get one signal |
| PATCH | `/api/v1/signals/:id` | Update signal |
| PATCH | `/api/v1/signals/:id/toggle` | Toggle `is_active` |
| DELETE | `/api/v1/signals/:id` | Delete signal |
| GET | `/api/v1/signals/:id/history` | Evaluation and notification history |
| POST | `/api/v1/simulate/:id/simulate` | Simulate across a time range |
| POST | `/api/v1/simulate/:id/first-trigger` | Find first trigger in a range |

## Health

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-03-26T00:00:00.000Z",
  "capabilities": {
    "state": {
      "provider": "rpc",
      "enabled": true,
      "requiredEnv": [],
      "message": "state source family is enabled"
    },
    "indexed": {
      "provider": "envio",
      "enabled": false,
      "requiredEnv": ["ENVIO_ENDPOINT"],
      "reason": "ENVIO_ENDPOINT is not configured",
      "message": "indexed source family is disabled because ENVIO_ENDPOINT is not configured. Configure ENVIO_ENDPOINT to enable it."
    },
    "raw": {
      "provider": "hypersync",
      "enabled": false,
      "requiredEnv": ["ENVIO_API_TOKEN"],
      "reason": "ENVIO_API_TOKEN is not configured",
      "message": "raw source family is disabled because ENVIO_API_TOKEN is not configured. Configure ENVIO_API_TOKEN to enable it."
    }
  }
}
```

`GET /health` is a fast liveness endpoint. It reports configured source capabilities, not live upstream reachability.

```http
GET /ready
```

`GET /ready` performs a cached readiness probe against PostgreSQL, Redis, RPC, and any configured indexed/raw providers. It returns `200` when all enabled dependencies are reachable and `503` when the process is up but one of those dependencies is not ready.

### Delivery Service

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/link?token=...&app_user_id=...` | Hosted Telegram link page |
| POST | `/link/connect` | Link `app_user_id` to a Telegram chat |
| POST | `/webhook/deliver` | Receive Sentinel webhook and deliver to Telegram |
| GET | `/admin/stats` | Delivery stats |
| GET | `/internal/integrations/telegram/:appUserId` | Internal Telegram status lookup |
| POST | `/internal/integrations/telegram/:appUserId/link` | Internal token-to-user Telegram link |

## Auth Flows

### Register For API-Key Access

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

Response:

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "api_key_id": "2e4d1e12-3a0d-4b0c-9b54-7a1f4d8c3ed1",
  "api_key": "sentinel_..."
}
```

### Browser Login With SIWE

Issue a nonce:

```http
POST /api/v1/auth/siwe/nonce
```

Response:

```json
{
  "provider": "wallet",
  "nonce": "abc123...",
  "expires_at": "2026-03-17T08:10:00.000Z",
  "domain": "localhost:3000",
  "uri": "http://localhost:3000"
}
```

Verify the signed message:

```http
POST /api/v1/auth/siwe/verify
Content-Type: application/json

{
  "message": "localhost:3000 wants you to sign in with your Ethereum account: ...",
  "signature": "0x...",
  "name": "Local Dev"
}
```

Response:

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "2e4d1e12-3a0d-4b0c-9b54-7a1f4d8c3ed1",
  "session_token": "sentinel_session_...",
  "expires_at": "2026-04-16T08:00:00.000Z",
  "created": true,
  "auth_method": "session",
  "identity": {
    "provider": "wallet",
    "provider_subject": "0xabc..."
  }
}
```

Successful verification also sets an `HttpOnly` session cookie.

### Authenticated Profile

```http
GET /api/v1/auth/me
Cookie: sentinel_session=sentinel_session_...
```

or

```http
GET /api/v1/auth/me
X-API-Key: sentinel_...
```

Response:

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Local Dev",
  "created_at": "2026-03-17T08:00:00.000Z",
  "auth_method": "session",
  "api_key_id": null,
  "session_id": "2e4d1e12-3a0d-4b0c-9b54-7a1f4d8c3ed1",
  "identities": [
    {
      "id": "8f2c...",
      "provider": "wallet",
      "provider_subject": "0xabc...",
      "created_at": "2026-03-17T08:00:00.000Z",
      "metadata": {
        "address": "0xabc...",
        "chain_id": 1
      }
    }
  ]
}
```

### Logout

```http
POST /api/v1/auth/logout
Cookie: sentinel_session=sentinel_session_...
```

Response:

```json
{
  "success": true
}
```

## Telegram Integration Endpoints

Status:

```http
GET /api/v1/me/integrations/telegram
Cookie: sentinel_session=sentinel_session_...
```

Response when linked:

```json
{
  "provider": "telegram",
  "linked": true,
  "app_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "telegram_username": "sentinel_user",
  "linked_at": "2026-03-17T08:00:00.000Z"
}
```

Response when not linked:

```json
{
  "provider": "telegram",
  "linked": false,
  "app_user_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Link a Telegram token the user received from the bot:

```http
POST /api/v1/me/integrations/telegram/link
Content-Type: application/json
Cookie: sentinel_session=sentinel_session_...

{
  "token": "telegram-pending-link-token"
}
```

## Create Signal

```http
POST /api/v1/signals
Content-Type: application/json
X-API-Key: sentinel_...
```

Protected product routes also accept a Sentinel session cookie or bearer token.

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

For Sentinel-managed Telegram delivery, the browser can send:

```json
{
  "name": "Telegram Alert",
  "definition": { "...": "see DSL.md" },
  "delivery": { "provider": "telegram" },
  "cooldown_minutes": 5
}
```

In that mode, Sentinel resolves the actual delivery webhook target server-side using `DELIVERY_BASE_URL`. The client should not submit internal Docker or private-network hostnames.

Use [DSL.md](./DSL.md) for:

- reference families: state, indexed, raw
- condition input rules
- canonical signal examples

If a request uses a disabled source family, Sentinel returns `409 Conflict` instead of accepting the signal and failing later.
That applies to create, update, toggle-on, and simulation routes.

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

If you set `is_active: true` on a signal whose required source family is disabled, the API returns `409`.

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

Simulation also returns `409` if the stored signal depends on a disabled source family.

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
