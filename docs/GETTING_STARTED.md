# Getting Started

This is the canonical local setup guide. Other docs should point here instead of repeating setup steps.

## Prerequisites

- Node.js 22+
- pnpm via Corepack
- Docker Desktop

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
```

## Env Files

Create both env files once:

```bash
cp .env.example .env
cp packages/delivery/.env.example packages/delivery/.env
```

Main service `.env`:

- required: `DATABASE_URL`
- recommended: `REDIS_URL`
- recommended: `RPC_URL_*` for the chains you care about
- optional: `ENVIO_ENDPOINT` to enable indexed semantic signals
- optional: `ENVIO_API_TOKEN` to enable `raw-events`
- optional: `WEBHOOK_SECRET` if you will use signed delivery
- optional: `REGISTER_ADMIN_KEY` if you want to gate `POST /api/v1/auth/register`
- optional but recommended for browser auth: `AUTH_SIWE_DOMAIN`, `AUTH_SIWE_URI`
- optional: `DELIVERY_BASE_URL`, `DELIVERY_ADMIN_KEY` if you want Sentinel-native Telegram status routes

When you run the Docker stack, Compose overrides `DELIVERY_BASE_URL` to `http://delivery:3100` so the API container can reach the delivery container over the Docker network.

If `ENVIO_ENDPOINT` is missing, indexed semantic refs stay disabled.
If `ENVIO_API_TOKEN` is missing, `raw-events` stay disabled.
Sentinel still boots, reports that through `GET /health`, and rejects unsupported signal definitions through the API.

Delivery service `packages/delivery/.env`:

- required only if you are running Telegram delivery
- required: `TELEGRAM_BOT_TOKEN`
- required: `LINK_BASE_URL`
- use the same shared webhook secret as the main service when delivery is enabled
- optional: `ADMIN_KEY` if you want a dedicated secret for delivery admin/internal routes

The example files already include the local Docker database URLs.

Database lifecycle:

- Docker Postgres creates `sentinel` on first boot via `POSTGRES_DB`
- Docker Postgres creates `sentinel_delivery` on first boot via `docker/postgres/init`
- versioned SQL migrations then run before the app services start

## Start The Stack

Core stack only:

```bash
pnpm docker:up
```

Core stack plus Telegram delivery:

```bash
pnpm docker:up:all
```

Useful commands:

```bash
pnpm docker:logs
pnpm docker:logs:all
pnpm docker:down
pnpm docker:reset
```

If you prefer raw Docker Compose, the wrappers call `docker compose` underneath.
The wrappers also recreate the one-shot migration containers so pending migrations are reapplied cleanly on each startup.

## Health Checks

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3100/health
docker compose ps
```

If you only started the core stack, `3100` will not be up.

`GET /health` includes source-family capability status so you can verify whether `state`, `indexed`, and `raw` are enabled before wiring the product UI.
`GET /ready` performs a cached dependency probe against PostgreSQL, Redis, RPC, and any configured indexed/raw providers.

## Live Integration Tests

Most tests run locally with no extra setup:

```bash
pnpm test
```

Live network suites are opt-in and environment-gated:

- fixed snapshot Envio + RPC checks:
  `RUN_LIVE_SNAPSHOT_TESTS=true pnpm test:integration:fixed`
- live RPC block resolver checks:
  `RUN_LIVE_RPC_INTEGRATION_TESTS=true pnpm test:integration:rpc`
- live HyperSync raw-event checks:
  `RUN_LIVE_HYPERSYNC_TESTS=true pnpm test:integration:hypersync`

For the live HyperSync suite, configure:

- `ENVIO_API_TOKEN` for HyperSync access
- `RPC_URL_1` for mainnet timestamp -> block resolution
- optional `HYPERSYNC_URL_1` if you want to override the default endpoint

For the fixed Envio + RPC snapshot suite, configure:

- `ENVIO_ENDPOINT`
- `RPC_URL_1`

## Create An API Key

```bash
curl -sS -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"local-dev","key_name":"curl"}'
```

If `REGISTER_ADMIN_KEY` is set, also send:

```http
X-Admin-Key: <register_admin_key>
```

Use the returned key on all protected API calls:

```http
X-API-Key: sentinel_...
```

## Browser Login Smoke Test

1. Request a nonce:

```bash
curl -sS -X POST http://localhost:3000/api/v1/auth/siwe/nonce
```

2. Build a SIWE message for the returned `nonce`, `domain`, and `uri`.
3. Sign it in your wallet client.
4. Verify it:

```bash
curl -sS -X POST http://localhost:3000/api/v1/auth/siwe/verify \
  -H "Content-Type: application/json" \
  -d '{"message":"<signed-siwe-message>","signature":"0x..."}'
```

The response returns both a session cookie and a `session_token`. You can use that token as:

```http
Authorization: Bearer sentinel_session_...
```

## Create Your First Signal

Use the endpoint contract in [API.md](./API.md) and the canonical signal examples in [DSL.md](./DSL.md).

Before writing a signal, choose one DSL reference family:

- state metrics for current or historical onchain state
- indexed metrics for semantic indexed entities and event history
- raw events for decoded log scans like ERC-20 transfers or swap activity

If you are bypassing Sentinel-managed Telegram delivery and setting the raw
`webhook_url` manually, use:

```text
http://delivery:3100/webhook/deliver
```

Do not use `http://localhost:3100/webhook/deliver` for container-to-container delivery. From the worker container, `localhost` is the worker itself.

## Telegram Smoke Test

1. Start the full stack with `pnpm docker:up:all`.
2. Send `/start` to the bot.
3. Open the returned link and connect it with your Sentinel `user_id`, or exchange the token through `POST /api/v1/me/integrations/telegram/link` once you have a session.
4. Create a signal with `delivery: { "provider": "telegram" }`, or manually point `webhook_url` at the delivery service if you are bypassing the managed path.
5. Wait for the worker to evaluate and dispatch the webhook.

The delivery contract is documented in [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md).

## Next Docs

- [DSL.md](./DSL.md) for signal definitions, reference families, and examples
- [ARCHITECTURE.md](./ARCHITECTURE.md) for internal system design
- [API.md](./API.md) for routes and payloads
- [AUTH.md](./AUTH.md) for auth and register-gate behavior
- [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
- [WEBAPP_INTEGRATION.md](./WEBAPP_INTEGRATION.md) for backend integration
