# Telegram Delivery Architecture

Launch architecture for Telegram delivery.

## Flow

1. User sends `/start` to Telegram bot.
2. Bot generates `token` and sends link: `https://<delivery-host>/link?token=...`
3. User opens link page and submits `app_user_id`.
4. Delivery service stores mapping: `app_user_id -> telegram_chat_id`.
5. Sentinel worker triggers signal and posts signed webhook to delivery.
6. Delivery resolves `context.app_user_id`, sends Telegram alert, logs delivery result.

## Required Webhook Contract

Delivery requires:

- `X-Sentinel-Signature` header (HMAC)
- JSON payload with:
  - `signal_id`
  - `triggered_at`
  - `context.app_user_id`
  - optional `signal_name`, `summary`, `context.address`, `context.market_id`, `context.chain_id`

## Delivery Endpoints

- `GET /health`
- `GET /link?token=...`
- `POST /link/connect`
- `POST /webhook/deliver`
- `GET /admin/stats`

## Security Model

- Link tokens expire quickly (`pending_links.expires_at`).
- Webhook authenticity is enforced via HMAC signature verification.
- Admin stats endpoint is protected by `X-Admin-Key`.
