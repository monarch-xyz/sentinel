# Getting Started

## Prerequisites

- Node.js 22+
- pnpm (via Corepack)
- Docker

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

## Setup

```bash
pnpm install
cp .env.example .env
cp packages/delivery/.env.example packages/delivery/.env
```

Required env values:

- `.env`: `DATABASE_URL`, `ENVIO_ENDPOINT`
- `packages/delivery/.env`: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`
- `WEBHOOK_SECRET` should match between both services

## Start Full Stack

```bash
docker compose down -v --remove-orphans
docker compose up --build -d
```

This single command starts:

- postgres
- redis
- API
- worker
- delivery
- automatic DB migration jobs

Check:

```bash
docker compose ps
curl http://localhost:3000/health
curl http://localhost:3100/health
```

Stop:

```bash
docker compose down
```

## Create API Key

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"local-dev"}'
```

Use the returned key as:

```http
X-API-Key: sentinel_...
```

## Telegram Smoke Test (Local)

1. Set `LINK_BASE_URL=http://localhost:3100` in `packages/delivery/.env`.
2. Start all services with `pnpm dev:all`.
3. In Telegram, send `/start` to your bot.
4. Open the returned `/link?token=...` URL and connect with your Sentinel `user_id`.
5. Create a signal with:
   - `webhook_url: "http://localhost:3100/webhook/deliver"`
6. Wait for a trigger; message should be delivered to the linked chat.

## Testing

```bash
pnpm test
pnpm test:integration
pnpm typecheck
pnpm build
```

## Next Steps

- Read [AUTH.md](./AUTH.md) for API key architecture
- Read [API.md](./API.md) for endpoint inventory
- Read [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md) for bot linking + webhook flow
- Read [WEBAPP_INTEGRATION.md](./WEBAPP_INTEGRATION.md) for Supabase mapping and backend integration
