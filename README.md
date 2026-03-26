# Sentinel

Composable signal monitoring for DeFi. Sentinel stores user-scoped signals, evaluates them on a worker, and dispatches webhooks when conditions trigger. Human users authenticate with sessions, programs authenticate with API keys, and Telegram delivery remains an optional separate service.

Sentinel currently supports three DSL reference families:

- RPC-backed state and historical state
- indexed entities and indexed event metrics
- raw event scans via the `raw-events` DSL condition, including swap presets

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
- `src/engine` — DSL compilation, source planning, and evaluation logic
- `src/indexing` — unified indexed/raw history boundary for Envio + HyperSync
- `src/envio` — indexed provider adapter
- `src/hypersync` — raw provider adapter
- `packages/delivery` — Telegram delivery service
- `docs` — canonical project documentation

## Status

See [TODO.md](./TODO.md) for implementation progress and [ROADMAP.md](./docs/ROADMAP.md) for planned work.
