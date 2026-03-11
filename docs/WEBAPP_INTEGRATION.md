# Webapp Integration

This document owns the backend integration contract for applications that sit in front of Sentinel.

## Core Model

Use Sentinel as a backend service with per-user API keys.

- your app owns end-user auth
- Sentinel owns signal evaluation and delivery
- your backend mediates calls between them

Do not expose Sentinel API keys directly to browser clients.

## Required Mapping

Persist this mapping in your application database:

- `app_user_id`
- `sentinel_user_id`
- `sentinel_api_key`

If you use Supabase, `app_user_id` is usually the Supabase user ID.

## Backend Call Pattern

1. user authenticates with your app
2. browser calls your backend
3. backend looks up or creates Sentinel credentials
4. backend calls Sentinel with that user’s API key
5. backend stores signal IDs and related metadata as needed

## Telegram Contract

For direct delivery integration:

- Telegram linking must use `app_user_id = sentinel_user_id`
- this matches the current worker contract for `context.app_user_id`

If you want Telegram keyed by your app’s own IDs instead, add a translator:

1. worker sends webhook to your backend
2. backend rewrites `context.app_user_id`
3. backend forwards the webhook to delivery

Without that translator, use the Sentinel user ID as the Telegram link identity.

## Signal History Access

Signal history remains user-scoped to the Sentinel API key.

- route: `GET /api/v1/signals/:id/history`
- recommended path: browser -> your backend -> Sentinel

## Related Docs

- [AUTH.md](./AUTH.md) for the key model
- [API.md](./API.md) for routes
- [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md) for the delivery-side contract
