# Getting Started

## Prerequisites

- Node.js 22+
- pnpm
- Docker (for PostgreSQL + Redis)

## Setup

```bash
# Clone & install
git clone https://github.com/monarch-xyz/sentinel.git
cd sentinel
pnpm install

# Configure
cp .env.example .env
# Edit .env with your ENVIO_ENDPOINT (and optional WEBHOOK_SECRET, RPC URLs)

# Start services
docker compose up -d    # PostgreSQL + Redis
pnpm db:migrate         # Run migrations
pnpm dev                # Start API + Worker
```

If you want to run migrations without Docker:

```bash
pnpm db:migrate:direct
```

## Create an API Key (Local)

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"local-dev"}'
```

Use the returned `api_key` in requests:

```
X-API-Key: <your_key>
```

## Test a Condition Locally

```bash
# Test if utilization > 90%
pnpm test:condition --inline '{
  "type": "threshold",
  "metric": "Morpho.Market.utilization",
  "operator": ">",
  "value": 0.9
}'

# Dry run (show compiled AST only)
pnpm test:condition --dry-run --inline '{...}'
```

## Run Tests

```bash
pnpm test           # All tests
pnpm test:unit      # Unit only
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `ENVIO_ENDPOINT` | ✅ | Envio GraphQL endpoint |
| `API_PORT` | | Default: 3000 |
| `WORKER_INTERVAL_SECONDS` | | Default: 30 |
| `LOG_LEVEL` | | Default: info |
| `WEBHOOK_SECRET` | | Optional HMAC signing secret |
| `ENVIO_VALIDATE_SCHEMA` | | Default: true (skip in tests) |
| `RPC_URL_1` | | Optional RPC URL for chain 1 (and other chains as needed) |

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for DSL reference and examples
- Read [API.md](./API.md) for REST endpoints
- Read [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md) for technical decisions
