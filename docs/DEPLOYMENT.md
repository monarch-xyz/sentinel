# Deployment (Railway)

This guide covers a minimal, production-ready Railway setup.

## Services

Deploy services from the same repo/image:

1. **API Service**
   - Command: `node dist/api/index.js`

2. **Worker Service**
   - Command: `node dist/worker/index.js`

3. **Delivery Service** (required for Telegram)
   - Command: `pnpm -F @sentinel/delivery start`

Why split services: the worker runs BullMQ processing/scheduling and delivery runs bot + webhook receiver. Isolation avoids cross-impact during spikes.

## Required Add-ons

- **PostgreSQL**
- **Redis**

## Environment Variables

Set these on API and Worker unless noted:

- `DATABASE_URL` (from Railway Postgres)
- `REDIS_URL` (from Railway Redis)
- `ENVIO_ENDPOINT`
- `RPC_URL_1` (and any other chain RPC URLs you need)
- `WEBHOOK_SECRET` (optional but recommended)
- `WORKER_INTERVAL_SECONDS` (optional, default 30)
- `LOG_LEVEL` (optional)

Set these on Delivery service:

- `DATABASE_URL` (delivery DB, e.g. `sentinel_delivery`)
- `TELEGRAM_BOT_TOKEN`
- `WEBHOOK_SECRET` (must match Sentinel `WEBHOOK_SECRET`)
- `LINK_BASE_URL`
- `PORT` / `HOST` / `LOG_LEVEL` (optional)

## Migrations

Run DB migrations once per deployment (Railway “Release Command” or one-off run):

```
node dist/scripts/migrate.js
```

This uses the bundled `schema.sql` and is safe to run multiple times.

For delivery DB:

```bash
pnpm -F @sentinel/delivery db:migrate
```

## Health Check

API service exposes:

```
GET /health
```

Delivery service exposes:

```text
GET /health
```

## Notes

- Rate limiting is in-memory today (per instance). If you run multiple API instances, add Redis-backed rate limits.
- Envio schema validation is enabled by default (disable with `ENVIO_VALIDATE_SCHEMA=false`).
