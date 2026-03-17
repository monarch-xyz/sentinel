-- Sentinel PostgreSQL Schema
-- Version: 1.0.0
-- Description: Core tables for signal monitoring and notifications

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  definition JSONB NOT NULL,
  webhook_url TEXT NOT NULL,
  cooldown_minutes INT NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_triggered_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ,
  CONSTRAINT signals_name_not_empty CHECK (name <> ''),
  CONSTRAINT signals_cooldown_positive CHECK (cooldown_minutes >= 0)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  name VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_signals_user_id ON signals(user_id);
CREATE INDEX IF NOT EXISTS idx_signals_active ON signals(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_signals_evaluation
  ON signals(last_evaluated_at)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_signals_definition ON signals USING GIN (definition);

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  webhook_status INT,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  evaluation_duration_ms INT,
  delivery_duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_log_signal ON notification_log(signal_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_triggered ON notification_log(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_failed
  ON notification_log(webhook_status)
  WHERE webhook_status IS NULL OR webhook_status >= 400;

CREATE TABLE IF NOT EXISTS signal_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  evaluated_at TIMESTAMPTZ NOT NULL,
  triggered BOOLEAN NOT NULL DEFAULT false,
  conclusive BOOLEAN NOT NULL DEFAULT true,
  in_cooldown BOOLEAN NOT NULL DEFAULT false,
  notification_attempted BOOLEAN NOT NULL DEFAULT false,
  notification_success BOOLEAN,
  webhook_status INT,
  error_message TEXT,
  evaluation_duration_ms INT,
  delivery_duration_ms INT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_run_log_signal
  ON signal_run_log(signal_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_run_log_triggered ON signal_run_log(triggered);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS signals_updated_at ON signals;
CREATE TRIGGER signals_updated_at
  BEFORE UPDATE ON signals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
