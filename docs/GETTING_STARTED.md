# Getting Started

## Prerequisites

- Node.js 18+
- pnpm
- Docker (for PostgreSQL + Redis)

## Setup

```bash
# Clone & install
git clone https://github.com/monarch-xyz/flare.git
cd flare
pnpm install

# Configure
cp .env.example .env
# Edit .env with your ENVIO_ENDPOINT and API_KEY

# Start services
docker compose up -d    # PostgreSQL + Redis
pnpm db:migrate         # Run migrations
pnpm dev                # Start API + Worker
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
| `API_KEY` | ✅ | API authentication key |
| `API_PORT` | | Default: 3000 |
| `WORKER_INTERVAL_SECONDS` | | Default: 30 |
| `LOG_LEVEL` | | Default: info |

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for DSL reference and examples
- Read [API.md](./API.md) for REST endpoints
- Read [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md) for technical decisions
