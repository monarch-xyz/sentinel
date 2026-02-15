# 📬 Sentinel Delivery

> Telegram delivery layer for Monarch Sentinel alerts

This service bridges Sentinel webhooks to Telegram, allowing users to receive DeFi alerts directly in their Telegram chat.

## Flow

```
1. User: /start in Telegram bot
2. Bot: Generates link → monarchlend.xyz/link?token=xxx
3. User: Connects wallet, signs message
4. Service: Stores wallet → chatId mapping
5. Sentinel: Triggers, sends webhook
6. Service: Looks up user, sends TG message
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up -d

# Create .env from example
cp .env.example .env
# Edit .env with your values

# Run migrations
pnpm db:migrate

# Start dev server
pnpm dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather |
| `WEBHOOK_SECRET` | Shared secret with Sentinel (min 32 chars) |
| `LINK_BASE_URL` | Base URL for wallet linking page |
| `PORT` | API server port (default: 3100) |

## API Endpoints

### Link Flow

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/link/message?token=xxx` | GET | Get message to sign |
| `/link/verify` | POST | Verify signature, link wallet |

### Webhook

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/deliver` | POST | Receive Sentinel webhook, deliver to TG |

### Admin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/stats` | GET | Get delivery stats (requires X-Admin-Key) |

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Generate wallet link |
| `/status` | Show linked wallets |
| `/unlink` | Remove wallet link |
| `/help` | Show help |

## Security

- **Wallet Ownership**: Users must sign EIP-191 message to prove wallet ownership
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
