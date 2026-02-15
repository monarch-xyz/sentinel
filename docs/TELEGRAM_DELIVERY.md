# Telegram Delivery Layer — Design Doc

> **Goal**: Let users receive Sentinel alerts via Telegram with minimal friction.

## User Flow

```
1. User opens @MonarchSentinelBot on Telegram
2. /start → Bot generates unique link:
   "Connect your wallet: https://sentinel.monarchlend.xyz/link?token=abc123"
3. User clicks link → connects wallet on web (wagmi/RainbowKit)
4. Backend stores: { wallet: "0x...", telegramChatId: 12345 }
5. User creates Sentinel signal via Monarch UI or API
6. When signal triggers → Sentinel webhook → Delivery Layer → TG message
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Current System                            │
│  ┌──────────┐    webhook     ┌─────────────┐                     │
│  │ Sentinel │ ─────────────> │ User's URL  │                     │
│  └──────────┘                └─────────────┘                     │
└──────────────────────────────────────────────────────────────────┘

                              ↓ Add Delivery Layer

┌──────────────────────────────────────────────────────────────────┐
│                         New System                                │
│                                                                   │
│  ┌──────────┐    webhook     ┌─────────────────┐   TG API        │
│  │ Sentinel │ ─────────────> │ Delivery Layer  │ ────────> TG    │
│  └──────────┘                └─────────────────┘                 │
│                                      │                            │
│                                      ▼                            │
│                              ┌─────────────┐                      │
│                              │ User Registry│                     │
│                              │ wallet→chatId│                     │
│                              └─────────────┘                      │
│                                      ▲                            │
│                                      │ link                       │
│                              ┌─────────────┐                      │
│                              │ /link page  │ ← wallet connect     │
│                              └─────────────┘                      │
└──────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Telegram Bot (@MonarchSentinelBot)

```typescript
// Commands
/start    → Generate link token, save pending_links[token] = chatId
/status   → Show linked wallets
/unlink   → Remove wallet association
```

### 2. Web Linking Page

Route: `sentinel.monarchlend.xyz/link?token=xxx`

```typescript
// Flow
1. Validate token exists in pending_links
2. Show "Connect Wallet" button (wagmi)
3. On connect: POST /api/link { token, walletAddress, signature }
4. Backend: 
   - Verify signature proves wallet ownership
   - Move pending_links[token] → users[wallet] = chatId
   - Return success
5. Show "✅ Linked! You'll receive alerts for 0x..."
```

### 3. Webhook Handler

Route: `POST /api/deliver`

```typescript
// Sentinel webhook payload
{
  "signal_id": "uuid",
  "triggered_at": "2026-02-16T00:30:00Z",
  "conditions": [...],
  "context": {
    "wallet": "0x...",
    "market_id": "0x...",
    "chain_id": 1
  }
}

// Handler
1. Extract wallet from context (or signal.address filter)
2. Lookup: SELECT telegram_chat_id FROM users WHERE wallet = ?
3. If found: send TG message with alert details
4. Log delivery attempt
```

## Database Schema

```sql
-- Pending link tokens (TTL: 15 min)
CREATE TABLE pending_links (
  token TEXT PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Verified user mappings
CREATE TABLE users (
  wallet TEXT PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL,
  linked_at TIMESTAMP DEFAULT NOW()
);

-- Delivery logs
CREATE TABLE deliveries (
  id SERIAL PRIMARY KEY,
  signal_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  telegram_chat_id BIGINT,
  status TEXT NOT NULL,  -- 'sent' | 'no_user' | 'failed'
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Implementation Options

### Option A: Separate Microservice

**sentinel-delivery** — standalone service

```
Tech: Node.js + grammy (TG bot) + Hono (API) + PostgreSQL
Deploy: Cloudflare Workers + D1, or Railway
```

Pros:
- Clean separation of concerns
- Can scale independently
- Sentinel stays focused on monitoring

Cons:
- Another service to maintain

### Option B: Add to Sentinel

Add `/api/v1/telegram/*` routes to existing Sentinel API

Pros:
- Single deployment
- Shared database

Cons:
- Bloats Sentinel responsibility
- Tighter coupling

### Option C: Cloudflare Workers (Zero Infra)

```
Worker + D1 + grammy (works in Workers)
```

Pros:
- Zero server management
- Global edge deployment
- Basically free at low scale

Cons:
- D1 is still beta
- Debugging is harder

## Recommendation

**Start with Option A** — a minimal Node.js service.

~300 lines of code:
- grammy for TG bot
- Hono for API
- pg for database
- Could share Sentinel's PostgreSQL or use SQLite

Later: Can be moved to Cloudflare Workers for scale.

## Message Format

```
🛡️ Sentinel Alert

📉 Position dropped 20% in 7 days

Market: WETH/USDC
Chain: Ethereum
Address: 0x1234...5678

[View on Monarch](https://monarchlend.xyz/position/...)
```

## Security Considerations

1. **Wallet ownership**: Require signature on link to prove wallet ownership
2. **Rate limits**: Limit link attempts per chatId
3. **Token expiry**: pending_links expire after 15 minutes
4. **Webhook auth**: Verify Sentinel webhook signature

## Open Questions

- [ ] Should users be able to link multiple wallets?
- [ ] Support for group chats (alert multiple users)?
- [ ] Premium features (more signals, faster delivery)?

---

## Next Steps

1. Create `sentinel-delivery` repo
2. Implement TG bot with /start
3. Build /link page (can be in sentinel-landing or separate)
4. Add webhook handler
5. Test E2E flow
