# Telegram Delivery

How Telegram alerts work in Sentinel v0.0.1.

## Services

- Sentinel API + Worker
- Delivery service (Telegram bot + webhook receiver)

## Data Contract

Delivery routes alerts by `context.app_user_id`.

Current Sentinel worker sets:

- `context.app_user_id = signals.user_id` (Sentinel internal user id)

So Telegram linking must store the same value as `app_user_id`.

## End-to-End Flow

1. User sends `/start` to the Telegram bot.
2. Bot creates short-lived `token` and returns:
   - `GET /link?token=...`
3. User completes linking:
   - `POST /link/connect` with `{ token, app_user_id }`
4. Delivery stores mapping:
   - `app_user_id -> telegram_chat_id`
5. Sentinel worker evaluates signals and sends signed webhook to delivery.
6. Delivery verifies signature, resolves mapping by `context.app_user_id`, sends message to mapped Telegram chat.

## Supabase Webapp Integration

Recommended:

- Supabase remains your login/session system.
- Your backend maps:
  - `supabase_user_id -> sentinel_user_id -> sentinel_api_key`
- When linking Telegram, call `/link/connect` with:
  - `app_user_id = sentinel_user_id`

If you pass Supabase user id directly without translation, delivery lookup will fail.

## Required Delivery Endpoints

- `GET /health`
- `GET /link`
- `POST /link/connect`
- `POST /webhook/deliver`
- `GET /admin/stats`

## Webhook Security

`POST /webhook/deliver` requires:

- Header: `X-Sentinel-Signature: t=<timestamp>,v1=<hmac>`
- Signature: `HMAC_SHA256(WEBHOOK_SECRET, "<timestamp>.<raw_body>")`
- Freshness check: 5-minute max age (default)

Set the same `WEBHOOK_SECRET` value in:

- Sentinel (`.env`)
- Delivery (`packages/delivery/.env`)

## Signal Configuration Requirement

For Telegram alerts, signals must use:

- `webhook_url = http://localhost:3100/webhook/deliver` (local)
- or your deployed delivery URL in production.

If signal webhook points elsewhere, Telegram delivery is bypassed.

## Bot Commands

- `/start` create link token
- `/status` show linked app accounts for the current chat
- `/unlink` remove a linked app account
- `/help` show help text
