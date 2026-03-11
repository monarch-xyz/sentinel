# Sentinel Delivery

Telegram delivery adapter for Sentinel.

This README is package-specific. Cross-service behavior lives in [../../docs/TELEGRAM_DELIVERY.md](../../docs/TELEGRAM_DELIVERY.md). Local setup lives in [../../docs/GETTING_STARTED.md](../../docs/GETTING_STARTED.md). Production deployment lives in [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## What This Package Owns

- Telegram bot polling
- link-token flow
- delivery webhook receiver
- delivery-side database for links and logs

## Package Commands

From the repo root:

```bash
pnpm -F @sentinel/delivery dev
pnpm -F @sentinel/delivery build
pnpm -F @sentinel/delivery start
pnpm -F @sentinel/delivery db:migrate
pnpm -F @sentinel/delivery db:migrate:prod
```

## Required Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Delivery PostgreSQL database |
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `LINK_BASE_URL` | Public base URL for `/link` |
| shared webhook secret | Verifies incoming Sentinel webhooks |
| `PORT` | HTTP port, default `3100` |
| `HOST` | Bind host, default `0.0.0.0` |

The shared webhook secret must match the main Sentinel service.

## HTTP Surface

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/link` | Hosted account-link page |
| POST | `/link/connect` | Link `app_user_id` to Telegram chat |
| POST | `/webhook/deliver` | Receive Sentinel webhook and send alert |
| GET | `/admin/stats` | Delivery stats |

Current implementation detail:

- `X-Admin-Key` for `/admin/stats` uses the shared webhook secret

## Local Notes

- when the full Docker stack is running, signals should target `http://delivery:3100/webhook/deliver`
- direct Telegram linking currently expects the Sentinel `user_id` as `app_user_id`

## Related Docs

- [../../docs/TELEGRAM_DELIVERY.md](../../docs/TELEGRAM_DELIVERY.md)
- [../../docs/WEBAPP_INTEGRATION.md](../../docs/WEBAPP_INTEGRATION.md)
- [../../docs/API.md](../../docs/API.md)
