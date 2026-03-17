-- Sentinel Delivery Schema

CREATE TABLE IF NOT EXISTS pending_links (
  token TEXT PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pending_links_expires ON pending_links(expires_at);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  app_user_id TEXT NOT NULL UNIQUE,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(telegram_chat_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_app_user_id_unique ON users(app_user_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  signal_id TEXT NOT NULL,
  signal_name TEXT,
  app_user_id TEXT,
  monitored_address TEXT,
  telegram_chat_id BIGINT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'no_user', 'failed', 'rate_limited')),
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_address ON deliveries(monitored_address);
CREATE INDEX IF NOT EXISTS idx_deliveries_app_user_id ON deliveries(app_user_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_created ON deliveries(created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);

CREATE TABLE IF NOT EXISTS rate_limits (
  telegram_chat_id BIGINT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (telegram_chat_id, window_start)
);

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM pending_links WHERE expires_at < NOW();
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql;
