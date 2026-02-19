# 📬 Sentinel Delivery

> Telegram delivery layer for Monarch Sentinel alerts

This service bridges Sentinel webhooks to Telegram, allowing users to receive DeFi alerts directly in their Telegram chat.

## Flow

```
1. User: /start in Telegram bot
2. Bot: Generates link → <LINK_BASE_URL>/link?token=xxx
3. User: Opens /link page and enters app_user_id
4. Service: Stores app_user_id → chatId mapping
5. Sentinel: Triggers, sends webhook
6. Service: Looks up user, sends TG message
```

For direct Sentinel integration, `app_user_id` must be the Sentinel `user_id` (from `/api/v1/auth/register`), because worker payloads use `context.app_user_id = signals.user_id`.

## Quick Start

```bash
# from repo root
pnpm install

# create env files first (required by docker compose)
cp .env.example .env
cp packages/delivery/.env.example packages/delivery/.env
# set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sentinel_delivery
# set TELEGRAM_BOT_TOKEN and WEBHOOK_SECRET

# services are now started by root docker compose
docker compose up --build -d
docker compose ps
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather |
| `WEBHOOK_SECRET` | Shared secret with Sentinel (min 32 chars) |
| `LINK_BASE_URL` | Base URL for Telegram account linking page |
| `PORT` | API server port (default: 3100) |

## API Endpoints

### Link Flow

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/link?token=xxx` | GET | Hosted link page |
| `/link/connect` | POST | Link Telegram to app user ID |

### Webhook

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/deliver` | POST | Receive Sentinel webhook, deliver to TG |

### Admin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/stats` | GET | Get delivery stats (requires X-Admin-Key) |

`X-Admin-Key` value is currently `WEBHOOK_SECRET`.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Generate account link |
| `/status` | Show linked accounts |
| `/unlink` | Remove linked account |
| `/help` | Show help |

## Security

- **Account Linking**: Users link Telegram chat to Sentinel app user ID via short-lived bot token
- **Webhook Auth**: Sentinel webhooks are verified with HMAC-SHA256 signatures
- **Rate Limiting**: Max 30 messages per user per hour
- **Token Expiry**: Link tokens expire after 15 minutes

## Architecture

```
┌────────────────┐
│   Telegram     │
│     Bot        │
└───────┬────────┘
        │
┌───────┴────────┐     ┌─────────────┐
│  API Server    │◄────│  Sentinel   │
│   (Hono)       │     │  Webhooks   │
└───────┬────────┘     └─────────────┘
        │
┌───────┴────────┐
│  PostgreSQL    │
│  (Users, Logs) │
└────────────────┘
```

## Deployment

### Railway

1. Create new project
2. Add PostgreSQL
3. Set environment variables
4. Deploy from GitHub

### Docker

```bash
docker build -t sentinel-delivery .
docker run -p 3100:3100 --env-file .env sentinel-delivery
```

## Integration with Sentinel

Add webhook URL to your Sentinel signal:

```json
{
  "webhook_url": "https://delivery.monarchlend.xyz/webhook/deliver"
}
```

Sentinel will sign webhooks with the shared secret.
