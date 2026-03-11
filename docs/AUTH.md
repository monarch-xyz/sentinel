# Auth Guide

This document owns the Sentinel auth model. Setup steps and endpoint payloads should link here instead of re-explaining auth inline.

## Main API Auth

Public routes:

- `GET /health`
- `POST /api/v1/auth/register` unless the register gate is enabled

Protected routes:

- all other `/api/v1/*` endpoints

Protected requests must send:

```http
X-API-Key: sentinel_...
```

Rules:

- API keys are scoped to one Sentinel user
- there is no single global API key env variable for request auth
- the client must send `X-API-Key` on every protected request

## Register Gate

You can temporarily gate user creation by setting:

- `REGISTER_ADMIN_KEY`

If it is set, `POST /api/v1/auth/register` also requires:

```http
X-Admin-Key: <register_admin_key>
```

If it is unset, register remains open.

## Key Handling

Treat Sentinel API keys as backend credentials:

- store them server-side
- do not expose them to browser clients
- map your app user to:
  - `sentinel_user_id`
  - `sentinel_api_key`

The recommended browser flow is:

1. browser authenticates with your app
2. browser calls your backend
3. backend calls Sentinel using the stored Sentinel API key

The app integration contract lives in [WEBAPP_INTEGRATION.md](./WEBAPP_INTEGRATION.md).

## Delivery Auth

Delivery webhook verification uses:

```http
X-Sentinel-Signature: t=<timestamp>,v1=<hex_hmac>
```

Signature model:

- signed payload: `HMAC_SHA256(WEBHOOK_SECRET, "<timestamp>.<raw_body>")`
- Sentinel signs outgoing webhooks when `WEBHOOK_SECRET` is set
- delivery verifies the same signature using its own `WEBHOOK_SECRET`

That secret must match on both services.

## Delivery Admin Endpoint

`GET /admin/stats` requires:

```http
X-Admin-Key: <delivery_admin_key>
```

Current implementation note:

- the delivery service currently uses `WEBHOOK_SECRET` as the admin key for that route

## Related Docs

- Endpoint reference: [API.md](./API.md)
- Local and production env ownership: [GETTING_STARTED.md](./GETTING_STARTED.md), [DEPLOYMENT.md](./DEPLOYMENT.md)
- Telegram flow and app user mapping: [TELEGRAM_DELIVERY.md](./TELEGRAM_DELIVERY.md)
