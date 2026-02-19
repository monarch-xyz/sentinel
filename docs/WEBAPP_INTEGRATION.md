# Webapp Integration (Supabase + Sentinel + Telegram)

This guide is the implementation contract for your webapp/backend team.

## Core Decision

Use Sentinel as a per-user API-key backend.

- Supabase remains your user auth system.
- Sentinel auth is separate and API-key based.
- Your webapp backend maps Supabase users to Sentinel users.

## Required ID Mapping

Persist this mapping in your webapp database:

- `supabase_user_id` (from Supabase auth)
- `sentinel_user_id` (returned by `POST /api/v1/auth/register`)
- `sentinel_api_key` (returned once; store encrypted)

Important: Telegram delivery uses `context.app_user_id`, which Sentinel currently sets to `sentinel_user_id`.  
So the Telegram link must use `app_user_id = sentinel_user_id` for direct delivery to work.

## End-to-End Flow

1. User signs in to your webapp with Supabase.
2. Webapp backend checks if user already has Sentinel credentials.
3. If not, webapp backend calls `POST /api/v1/auth/register` and stores `sentinel_user_id` + `sentinel_api_key`.
4. User creates signals in your UI.
5. Webapp backend calls Sentinel `/api/v1/signals*` using that user’s API key.
6. Each signal’s `webhook_url` should point to delivery: `POST /webhook/deliver`.
7. User sends `/start` to Telegram bot and gets a tokenized link.
8. Webapp (or delivery hosted page) calls `POST /link/connect` with:
   - `token` from bot link
   - `app_user_id` = mapped `sentinel_user_id`
9. Worker triggers signal, sends signed webhook, delivery service resolves mapping, message is sent to the linked Telegram chat.

## Who Can Read Signal History?

Signal history is API-key gated and user-scoped.

- Endpoint: `GET /api/v1/signals/:id/history`
- Access: only the Sentinel user associated with that API key can read their signal history.
- Recommended path: browser -> your webapp backend -> Sentinel API.

## Browser vs Backend Calls

Preferred:

- Browser calls your backend only.
- Your backend calls Sentinel and delivery services.

Why:

- Keeps Sentinel API keys out of browser storage.
- Avoids cross-origin surprises.
- Lets you enforce your own auth/authorization policy consistently.

## If You Want `app_user_id` To Be Supabase ID

Current Sentinel worker sends `context.app_user_id = sentinel_user_id`.

If you need delivery keyed by Supabase IDs instead, add a translation layer:

1. Use a webhook URL in your webapp backend.
2. Webapp backend receives Sentinel webhook.
3. Translate `sentinel_user_id` -> `supabase_user_id`.
4. Forward to delivery with rewritten `context.app_user_id`.

Without this translator, use `sentinel_user_id` for Telegram linking.
