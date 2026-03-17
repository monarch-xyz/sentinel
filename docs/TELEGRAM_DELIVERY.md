# Telegram Delivery

This document owns the cross-service Telegram contract. Package-local commands and runtime notes live in [../packages/delivery/README.md](../packages/delivery/README.md).

## Responsibility Split

- Sentinel API stores signals and owns the canonical user/account ID
- Sentinel worker evaluates signals and dispatches webhooks
- delivery service verifies the webhook, resolves `app_user_id`, and sends a Telegram message

Sentinel itself remains webhook-first. Telegram is an adapter service.

## Canonical User Mapping

Delivery routes alerts by `context.app_user_id`.

Current contract:

- Sentinel worker sets `context.app_user_id = signals.user_id`
- direct Telegram linking therefore uses the Sentinel `users.id`
- delivery stores that same ID in `users.app_user_id`

This is the stable owner bridge between the core signal system and Telegram delivery.

## End-To-End Flow

1. user sends `/start` to the Telegram bot
2. bot creates a short-lived token in delivery
3. user either opens the hosted delivery link page or submits the token through Sentinel’s `/api/v1/me/integrations/telegram/link`
4. delivery maps the token to the Sentinel `users.id`
5. worker evaluates a signal and dispatches a signed webhook
6. delivery verifies the webhook
7. delivery maps `app_user_id` to a Telegram chat and sends the message

## Sentinel-Native Integration Endpoints

The web app should prefer Sentinel-native status and link routes:

- `GET /api/v1/me/integrations/telegram`
- `POST /api/v1/me/integrations/telegram/link`

Sentinel fulfills those through delivery’s internal admin endpoints:

- `GET /internal/integrations/telegram/:appUserId`
- `POST /internal/integrations/telegram/:appUserId/link`

That keeps the web app from having to know the raw cross-service delivery details.

## Required Webhook Target

For local Docker development:

```text
http://delivery:3100/webhook/deliver
```

For production:

- use the public URL of your deployed delivery service

If a signal points to another webhook URL, Telegram delivery is bypassed.

## Security Contract

Incoming delivery webhooks require:

- `X-Sentinel-Signature`
- `t=<timestamp>,v1=<hmac>` header format
- HMAC over `"<timestamp>.<raw_body>"`

The same shared webhook secret must be configured on both the main service and the delivery service.

Internal status and link endpoints require:

- `X-Admin-Key`
- `ADMIN_KEY` on delivery if you want a dedicated admin secret
- otherwise delivery falls back to `WEBHOOK_SECRET`

Setup locations live in [GETTING_STARTED.md](./GETTING_STARTED.md) and [DEPLOYMENT.md](./DEPLOYMENT.md).

## Related Docs

- [AUTH.md](./AUTH.md) for shared-secret and admin-key behavior
- [API.md](./API.md) for route details
- [WEBAPP_INTEGRATION.md](./WEBAPP_INTEGRATION.md) for browser integration
- [../packages/delivery/README.md](../packages/delivery/README.md) for delivery package commands
