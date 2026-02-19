# Sentinel Auth Guide

This project uses **API key auth** for the main Sentinel API.

## Recommended Architecture

Use API keys per user, managed by your webapp backend.

1. Browser authenticates with your webapp backend.
2. Webapp backend calls Sentinel using that user's Sentinel API key.
3. Browser never receives or stores Sentinel API keys.

This keeps Sentinel integration simple while preserving per-user data isolation.

## Key Rules

- Every Sentinel user should have their own API key.
- Keep keys server-side only (encrypted at rest in your webapp DB).
- Rotate/revoke keys through backend processes, not browser clients.

## Create a Sentinel API Key

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "name": "webapp-user-123"
}
```

Response includes:

- `user_id`
- `api_key_id`
- `api_key`

Use that `api_key` on subsequent requests:

```http
X-API-Key: sentinel_...
```

## Main API Auth Behavior

- `/health` and `/api/v1/auth/register` are public.
- All other `/api/v1/*` endpoints require `X-API-Key`.
- Access is scoped to the user attached to the API key.

## Delivery Service Auth Behavior

- `/webhook/deliver` uses signed webhook verification (`X-Sentinel-Signature`).
- `/admin/stats` uses `X-Admin-Key`.
- Linking routes use short-lived link tokens.
