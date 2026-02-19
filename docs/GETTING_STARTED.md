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

## Start Dependencies And Initialize Schemas

```bash
docker compose down -v --remove-orphans
docker compose up -d
pnpm db:migrate
docker exec -i sentinel-postgres psql -U postgres -c 'CREATE DATABASE sentinel_delivery;' || true
pnpm delivery:db:migrate
```

## Run Services

```bash
pnpm dev      # API + worker
pnpm dev:all  # API + worker + delivery
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
