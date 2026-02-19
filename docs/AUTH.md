# Sentinel Auth Guide

Sentinel uses API-key auth for the main API and signed webhooks for delivery.

## Main API Auth

- Public:
  - `GET /health`
  - `POST /api/v1/auth/register`
- API-key protected:
  - all other `/api/v1/*` endpoints

Header:

```http
X-API-Key: sentinel_...
```

Keys are scoped to exactly one Sentinel user.

## Recommended Webapp Pattern

1. Browser authenticates with Supabase.
2. Browser calls your webapp backend.
3. Webapp backend calls Sentinel with that user’s Sentinel API key.

Do not expose Sentinel API keys to browser clients.

## Registering A Sentinel User + Key

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "name": "supabase-user-123"
}
```

Response:

- `user_id` (Sentinel user id)
- `api_key_id`
- `api_key` (returned once)

Store this mapping in your webapp DB:

- `supabase_user_id`
- `sentinel_user_id` (`user_id` from register)
- `sentinel_api_key` (encrypted)

## Access To History

History is API-key gated and user-scoped.

- Endpoint: `GET /api/v1/signals/:id/history`
- A key can only read signal history for signals owned by its user.

## Delivery Auth

- `POST /webhook/deliver` requires `X-Sentinel-Signature` header.
- Signature format: `t=<timestamp>,v1=<hex_hmac>`
- Signed payload: `HMAC_SHA256(secret, "<timestamp>.<raw_body>")`
- `GET /admin/stats` requires `X-Admin-Key` (currently same value as `WEBHOOK_SECRET`).

## Telegram Linking Auth

- Link endpoints are token-based:
  - `GET /link?token=...`
  - `POST /link/connect`
- Link tokens are short-lived and created by bot `/start`.
