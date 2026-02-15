-- Sentinel Delivery Schema

-- Pending link tokens (short-lived, for wallet linking flow)
CREATE TABLE IF NOT EXISTS pending_links (
  token TEXT PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '15 minutes')
);

-- Create index for cleanup job
CREATE INDEX IF NOT EXISTS idx_pending_links_expires ON pending_links(expires_at);

-- Verified user wallet mappings
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  
  -- Allow multiple wallets per user, but each wallet only links once
  UNIQUE(wallet)
);

-- Index for fast lookups by wallet (most common query)
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet);
CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(telegram_chat_id);

-- Delivery logs for debugging and analytics
CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  signal_id TEXT NOT NULL,
  signal_name TEXT,
  wallet TEXT NOT NULL,
  telegram_chat_id BIGINT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'no_user', 'failed', 'rate_limited')),
  error TEXT,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for querying delivery history
CREATE INDEX IF NOT EXISTS idx_deliveries_wallet ON deliveries(wallet);
CREATE INDEX IF NOT EXISTS idx_deliveries_created ON deliveries(created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);

-- Rate limiting table (per chat, per hour)
CREATE TABLE IF NOT EXISTS rate_limits (
  telegram_chat_id BIGINT NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  count INTEGER DEFAULT 1,
  PRIMARY KEY (telegram_chat_id, window_start)
);

-- Cleanup function for expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM pending_links WHERE expires_at < NOW();
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql;
