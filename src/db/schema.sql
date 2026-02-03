-- Flare PostgreSQL Schema
-- Version: 1.0.0
-- Description: Core tables for signal monitoring, notifications, and block snapshots

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SIGNALS TABLE
-- Stores user-defined monitoring signals with their DSL definitions
-- ============================================================================
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
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
-- SNAPSHOT_BLOCKS TABLE
-- Caches timestamp-to-block mappings for RPC historical state queries
-- Envio does not support time-travel; we use RPC eth_call with block numbers
-- ============================================================================
CREATE TABLE IF NOT EXISTS snapshot_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Chain identifier (e.g., 1 = Ethereum, 8453 = Base)
  chain_id INT NOT NULL,
  
  -- Timestamp being resolved
  target_timestamp TIMESTAMPTZ NOT NULL,
  
  -- Resolved block data
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,  -- Actual block timestamp (may differ slightly from target)
  
  -- Metadata
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure uniqueness per chain+timestamp combination
  CONSTRAINT snapshot_blocks_unique UNIQUE (chain_id, target_timestamp)
);

-- Index for quick lookups by chain and timestamp
CREATE INDEX IF NOT EXISTS idx_snapshot_blocks_lookup 
  ON snapshot_blocks(chain_id, target_timestamp);

-- Index for finding recent snapshots (for cache management)
CREATE INDEX IF NOT EXISTS idx_snapshot_blocks_resolved 
  ON snapshot_blocks(resolved_at DESC);

-- ============================================================================
-- EVALUATION_CACHE TABLE (Optional - for caching expensive query results)
-- Caches intermediate evaluation results to avoid redundant Envio queries
-- ============================================================================
CREATE TABLE IF NOT EXISTS evaluation_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Cache key (hash of query parameters)
  cache_key VARCHAR(64) NOT NULL UNIQUE,
  
  -- Cached data
  chain_id INT NOT NULL,
  query_type VARCHAR(50) NOT NULL,  -- 'event_aggregate', 'state_snapshot'
  query_params JSONB NOT NULL,
  result JSONB NOT NULL,
  
  -- Cache metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  
  -- Index for cleanup
  CONSTRAINT evaluation_cache_expiry CHECK (expires_at > created_at)
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_evaluation_cache_key 
  ON evaluation_cache(cache_key);

-- Index for cache cleanup (expired entries)
CREATE INDEX IF NOT EXISTS idx_evaluation_cache_expiry 
  ON evaluation_cache(expires_at);

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

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM evaluation_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ language 'plpgsql';
