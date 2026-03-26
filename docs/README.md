# Documentation Map

This folder is intentionally organized around canonical owners. If a topic appears in multiple places, one document owns the details and the others should link to it.

## Start Here

| Doc | Owns | Use it for |
| --- | --- | --- |
| [GETTING_STARTED.md](./GETTING_STARTED.md) | Local setup | Boot the stack locally, log in, mint an API key, and verify the app |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production setup | Docker and hosted deployment guidance |
| [DSL.md](./DSL.md) | Signal definition language | Scope, windows, reference families, condition inputs, metrics, and canonical examples |
| [API.md](./API.md) | HTTP surface | Endpoints, request shapes, webhook payloads, and simulation routes |

## Security And Integration

| Doc | Owns | Use it for |
| --- | --- | --- |
| [AUTH.md](./AUTH.md) | Auth model | SIWE, sessions, API keys, register gate, webhook signature model |
| [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md) | Cross-service Telegram contract | `app_user_id`, webhook target, token-link flow, internal status routes |
| [WEBAPP_INTEGRATION.md](./WEBAPP_INTEGRATION.md) | Backend integration contract | web app as Sentinel console, session flow, thin-BFF decisions |

## Internals

| Doc | Owns | Use it for |
| --- | --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design | Compiler/evaluator flow, indexing boundary vs RPC, and service responsibilities |
| [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md) | ADR-style reasoning | Why the current design looks the way it does |
| [ISSUE_NO_TIME_TRAVEL.md](./ISSUE_NO_TIME_TRAVEL.md) | Specific data-source constraint | Why state reads use RPC while events use Envio |

## Planning And Status

| Doc | Owns | Use it for |
| --- | --- | --- |
| [ROADMAP.md](./ROADMAP.md) | Product direction | Near-term and later priorities |
| [../TODO.md](../TODO.md) | Implementation status | Concrete work items in the repo |

## Package-Specific

| Doc | Owns | Use it for |
| --- | --- | --- |
| [../packages/delivery/README.md](../packages/delivery/README.md) | Delivery package details | Package-local commands and delivery-specific runtime notes |

## Ownership Rules

- Local setup belongs in [GETTING_STARTED.md](./GETTING_STARTED.md).
- Production setup belongs in [DEPLOYMENT.md](./DEPLOYMENT.md).
- DSL shape, reference families, and examples belong in [DSL.md](./DSL.md).
- Endpoint details belong in [API.md](./API.md).
- Auth and delivery docs describe contracts and routing, not setup steps.
