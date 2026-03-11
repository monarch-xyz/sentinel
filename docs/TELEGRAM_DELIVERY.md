# Telegram Delivery

This document owns the cross-service Telegram contract. Package-local commands and runtime notes live in [../packages/delivery/README.md](../packages/delivery/README.md).

## Responsibility Split

- Sentinel API stores signals
- Sentinel worker evaluates them and dispatches webhooks
- delivery service verifies the webhook, resolves `app_user_id`, and sends a Telegram message

Sentinel itself remains webhook-first. Telegram is an adapter service.

## Canonical User Mapping

Delivery routes alerts by `context.app_user_id`.

Current contract:

- Sentinel worker sets `context.app_user_id = signals.user_id`
- direct Telegram linking therefore uses the Sentinel `user_id`

If your app uses a different external user ID, translate it in your own webhook layer before forwarding to delivery.

## End-To-End Flow

1. user sends `/start` to the Telegram bot
2. bot creates a short-lived token
3. user opens `/link?token=...`
4. client posts `{ token, app_user_id }` to `/link/connect`
5. worker evaluates a signal and dispatches a signed webhook
6. delivery verifies the signature
7. delivery maps `app_user_id` to a Telegram chat and sends the message

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

The same shared webhook secret must be configured on both the main service and the delivery service. Setup locations live in [GETTING_STARTED.md](./GETTING_STARTED.md) and [DEPLOYMENT.md](./DEPLOYMENT.md).

## Related Docs

- [GETTING_STARTED.md](./GETTING_STARTED.md) for local setup
- [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
- [WEBAPP_INTEGRATION.md](./WEBAPP_INTEGRATION.md) for backend translation patterns
- [../packages/delivery/README.md](../packages/delivery/README.md) for delivery package commands
