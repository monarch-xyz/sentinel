-- Sentinel PostgreSQL Schema
-- Version: 1.0.0
-- Description: Core tables for signal monitoring, notifications, and block snapshots

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- USERS TABLE
-- Minimal user identity for API keys
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SIGNALS TABLE
-- Stores user-defined monitoring signals with their DSL definitions
-- ============================================================================
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Basic Info
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Signal Definition (DSL)
  -- Contains: chains, window, condition(s), logic
  definition JSONB NOT NULL,
  
  -- Delivery Configuration
  webhook_url TEXT NOT NULL,
  cooldown_minutes INT NOT NULL DEFAULT 5,
  
  -- State
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_triggered_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT signals_name_not_empty CHECK (name <> ''),
  CONSTRAINT signals_cooldown_positive CHECK (cooldown_minutes >= 0)
);

-- ============================================================================
-- API_KEYS TABLE
-- Stores hashed API keys for authentication
-- ============================================================================
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

-- Index for active signals (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_signals_active 
  ON signals(is_active) 
  WHERE is_active = true;

-- Index for finding signals due for evaluation
CREATE INDEX IF NOT EXISTS idx_signals_evaluation 
  ON signals(last_evaluated_at) 
  WHERE is_active = true;

-- GIN index for querying inside definition JSONB
CREATE INDEX IF NOT EXISTS idx_signals_definition 
  ON signals USING GIN (definition);

-- ============================================================================
-- NOTIFICATION_LOG TABLE
-- Audit trail of all triggered notifications and their delivery status
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to signal
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  
  -- Trigger details
  triggered_at TIMESTAMPTZ NOT NULL,
  
  -- Evaluation context
  payload JSONB NOT NULL,  -- Contains: evaluated values, condition results, metadata
  
  -- Delivery status
  webhook_status INT,      -- HTTP status code (null if not yet delivered)
  error_message TEXT,      -- Error details if delivery failed
  retry_count INT NOT NULL DEFAULT 0,
  
  -- Performance metrics
  evaluation_duration_ms INT,  -- Time to evaluate the signal
  delivery_duration_ms INT,    -- Time to deliver webhook
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

-- Index for querying notifications by signal
CREATE INDEX IF NOT EXISTS idx_notification_log_signal 
  ON notification_log(signal_id);

-- Index for finding notifications by trigger time (for analytics)
CREATE INDEX IF NOT EXISTS idx_notification_log_triggered 
  ON notification_log(triggered_at DESC);

-- Index for finding failed deliveries (for retry logic)
CREATE INDEX IF NOT EXISTS idx_notification_log_failed 
  ON notification_log(webhook_status) 
  WHERE webhook_status IS NULL OR webhook_status >= 400;

-- ============================================================================
-- SIGNAL_RUN_LOG TABLE
-- Stores every evaluation run (including non-triggered checks)
-- ============================================================================
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

CREATE INDEX IF NOT EXISTS idx_signal_run_log_triggered
  ON signal_run_log(triggered);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for signals table
DROP TRIGGER IF EXISTS signals_updated_at ON signals;
CREATE TRIGGER signals_updated_at
  BEFORE UPDATE ON signals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
