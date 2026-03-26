# Deployment

This document owns production deployment. Local development lives in [GETTING_STARTED.md](./GETTING_STARTED.md).

## Service Topology

Core services:

- API
- worker
- PostgreSQL
- Redis
- main-migrate

Optional service:

- delivery (Telegram bot + webhook receiver)
- delivery-migrate

API and worker are intentionally separate processes. The worker owns scheduling and webhook dispatch; delivery owns Telegram-specific logic.

## Required Configuration

API and worker:

- `DATABASE_URL`
- `REDIS_URL`
- `RPC_URL_*` for the chains you need
- `AUTH_SIWE_DOMAIN`
- `AUTH_SIWE_URI`
- optional `ENVIO_ENDPOINT` if you want indexed semantic signals
- optional `ENVIO_API_TOKEN` if you want `raw-events`
- optional shared webhook secret for signed outbound webhooks
- optional `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`, `NONCE_TTL_MINUTES`
- optional `DELIVERY_BASE_URL`, `DELIVERY_ADMIN_KEY` if using Sentinel-native Telegram integration routes
- optional `WORKER_INTERVAL_SECONDS`
- optional `LOG_LEVEL`

If API and delivery run as separate containers on the same private network, set `DELIVERY_BASE_URL` to the delivery service hostname rather than `localhost`.

Missing optional source config does not take the service down:

- without `ENVIO_ENDPOINT`, indexed semantic signal families are disabled
- without `ENVIO_API_TOKEN`, `raw-events` are disabled
- the API rejects unsupported signal definitions and activation attempts with a clear `409`
- `/health` advertises which source families are enabled

Delivery:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `LINK_BASE_URL`
- the same shared webhook secret used by the main service
- optional `ADMIN_KEY` if you want a separate secret for `/admin/*` and `/internal/*`
- optional `PORT`, `HOST`, `LOG_LEVEL`

## Single-Host Docker Compose

This is the simplest production path if you control one Linux box.

1. Clone the repo and create both env files.
2. Set production values in `.env` and `packages/delivery/.env`.
3. Start the required services:

```bash
docker compose up --build -d
```

If you do not need Telegram delivery yet, start only the core services:

```bash
docker compose up --build -d postgres redis main-migrate api worker
```

Database bootstrap model:

- `sentinel` is created by the Postgres container via `POSTGRES_DB`
- `sentinel_delivery` is created on first boot by the init script in `docker/postgres/init`
- `main-migrate` and `delivery-migrate` apply versioned SQL migrations before app services start

Health checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3100/health
```

## Standalone Docker Images

Main service image:

- image source: repo root `Dockerfile`
- API command: `node dist/api/index.js`
- worker command: `node dist/worker/index.js`
- migration command: `node dist/scripts/migrate.js`
- carries the compiled app plus the versioned SQL migrations directory

Delivery image:

- image source: `packages/delivery/Dockerfile`
- start command: `node dist/index.js`
- migration command: `node dist/scripts/migrate.js`
- carries its own versioned SQL migrations directory

## Hosted Platforms

Railway remains a viable hosted setup:

- one service for API
- one service for worker
- one optional service for delivery
- one PostgreSQL add-on
- one Redis add-on

Use the same runtime commands listed above and run migrations once per deploy or release.
Do not rely on application startup to mutate schema; run the migrator service as an explicit release step.

## Operational Notes

- use HTTPS in front of public webhook or delivery endpoints
- back up PostgreSQL data; Docker volumes are not backups
- if you scale the API horizontally, move rate limits off process memory
- Envio schema validation is on by default; disable only if you know why

## Related Docs

- [GETTING_STARTED.md](./GETTING_STARTED.md) for local setup
- [API.md](./API.md) for health and webhook routes
- [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md) for delivery contract details
