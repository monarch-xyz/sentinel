# 🛡️ Sentinel

Composable signal monitoring for DeFi. Sentinel stores user-scoped signals, evaluates them on a worker, and dispatches webhooks when conditions trigger. Telegram delivery is an optional separate service.

## Start Here

- [Docs Index](./docs/README.md) for the full documentation map
- [Getting Started](./docs/GETTING_STARTED.md) for local setup
- [DSL Reference](./docs/DSL.md) for signal definitions and examples
- [Architecture](./docs/ARCHITECTURE.md) for internal system design
- [API Reference](./docs/API.md) for endpoint contracts
- [Deployment](./docs/DEPLOYMENT.md) for production deployment

## Repo Structure

- `src/api` — REST API and auth middleware
- `src/worker` — scheduler, evaluator, and webhook dispatch
- `src/engine` — DSL compilation and evaluation logic
- `packages/delivery` — Telegram delivery service
- `docs` — canonical project documentation

## Status

See [TODO.md](./TODO.md) for implementation progress and [ROADMAP.md](./docs/ROADMAP.md) for planned work.
