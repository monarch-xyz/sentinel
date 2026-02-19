# Sentinel Quick Start

## 1. Prerequisites

```bash
node -v   # v22+
corepack enable
corepack prepare pnpm@latest --activate
docker --version
```

## 2. Install And Configure

```bash
pnpm install
cp .env.example .env
cp packages/delivery/.env.example packages/delivery/.env
```

Set required values:

- `.env`
  - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sentinel`
  - `ENVIO_ENDPOINT=...`
  - `WEBHOOK_SECRET=<shared-secret-used-by-delivery>`
- `packages/delivery/.env`
  - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sentinel_delivery`
  - `TELEGRAM_BOT_TOKEN=...`
  - `WEBHOOK_SECRET=<same-value-as-main-service>`
  - `LINK_BASE_URL=http://localhost:3100`

## 3. Start Datastores And Initialize Schemas

```bash
docker compose down -v --remove-orphans
docker compose up --build -d
```

## 4. Run Services

Services are started by Docker Compose in step 3 (`postgres`, `redis`, `api`, `worker`, `delivery`).

Check status:

```bash
docker compose ps
curl http://localhost:3000/health
curl http://localhost:3100/health
```

## 5. Verify

```bash
curl http://localhost:3000/health
curl http://localhost:3100/health

# Create API key
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"local-dev"}'
```

Use returned `api_key` as `X-API-Key` for `/api/v1/signals*` and `/api/v1/simulate*`.

## 6. Telegram Link Flow

1. User sends `/start` to the bot.
2. Bot sends `http://localhost:3100/link?token=...`.
3. User submits `app_user_id` on that page.
4. Use Sentinel `user_id` as `app_user_id` for direct delivery lookup.
5. Signal webhooks sent to `POST /webhook/deliver` are matched by `context.app_user_id`.

If you use Supabase IDs in your app, keep a mapping table:

- `supabase_user_id`
- `sentinel_user_id`
- `sentinel_api_key` (encrypted)
