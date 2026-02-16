# Sentinel Quick Start

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│   API       │────▶│    Worker    │────▶│  Delivery (TG)    │
│  :3000      │     │  (evaluator) │     │      :3100        │
└─────────────┘     └──────────────┘     └───────────────────┘
       │                   │                      │
       └───────────────────┴──────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
         PostgreSQL              Redis
           :5432                 :6379
```

## 1. First Time Setup

```bash
cd /Users/anton/projects/sentinel

# Install deps (if not done)
pnpm install

# Create .env from template
cp .env.example .env
```

### Edit `.env`:
```bash
# Required
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sentinel
ENVIO_ENDPOINT=https://indexer.bigdevenergy.link/your-endpoint/v1/graphql

# Optional but recommended for prod
WEBHOOK_SECRET=your-secret-here
RPC_URL_1=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### Delivery package setup:
```bash
cd packages/delivery
cp .env.example .env
```

Edit `packages/delivery/.env`:
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sentinel_delivery
TELEGRAM_BOT_TOKEN=<from @BotFather>
WEBHOOK_SECRET=<same as main sentinel>
LINK_BASE_URL=https://sentinel.monarchlend.xyz
```

## 2. Start Services

```bash
# Terminal 1: Start DB + Redis
docker compose up -d

# Terminal 2: Run migrations
pnpm db:migrate

# Terminal 3: Start API + Worker
pnpm dev

# Terminal 4 (optional): Start Telegram delivery
pnpm delivery:dev
```

Or all at once:
```bash
docker compose up -d && pnpm db:migrate && pnpm dev:all
```

## 3. Test It Works

```bash
# Health check
curl http://localhost:3000/health

# Create API key
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"local-dev"}' | jq

# Test a condition
pnpm test:condition --inline '{
  "type": "threshold",
  "metric": "Morpho.Market.utilization",
  "operator": ">",
  "value": 0.9
}'
```

## 4. Notifications Setup

### Option A: Telegram (via Delivery service)
1. Create bot via @BotFather
2. Add token to `packages/delivery/.env`
3. Run `pnpm delivery:dev`
4. Users `/start` the bot and link wallet

### Option B: Custom Webhook
When creating a signal, provide `webhook_url`:
```bash
curl -X POST http://localhost:3000/api/v1/signals \
  -H "X-API-Key: your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Alert",
    "conditions": [...],
    "webhook_url": "https://your-server.com/alerts"
  }'
```

### Option C: ntfy.sh (simple push)
```bash
# In webhook_url, use:
"webhook_url": "https://ntfy.sh/your-topic"
```

Then subscribe on phone: `ntfy.sh/your-topic`

## 5. Deploy to Railway

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

Quick summary:
- Create PostgreSQL + Redis add-ons
- Deploy API: `node dist/api/index.js`
- Deploy Worker: `node dist/worker/index.js`
- Deploy Delivery (optional): `node packages/delivery/dist/index.js`

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start API + Worker |
| `pnpm dev:all` | Start API + Worker + Delivery |
| `pnpm test` | Run tests |
| `pnpm db:migrate` | Run migrations (Docker) |
| `pnpm db:reset` | Reset DB (dev only!) |
| `pnpm build` | Build for production |
