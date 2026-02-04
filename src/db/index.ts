import pg from "pg";
import { config } from "../config/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";
import { schema } from "./schema.js";

const logger = createLogger("db");
const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.url,
});

export async function initDb() {
  try {
    await pool.query(schema);
    logger.info("Database initialized successfully");
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Database initialization failed");
    throw error;
  }
}

export async function closeDb() {
  await pool.end();
  logger.info("Database connection closed");
}

// ============================================================================
// SIGNAL REPOSITORY
// ============================================================================

interface CreateSignalInput {
  user_id: string;
  name: string;
  description?: string;
  definition: unknown;
  webhook_url: string;
  cooldown_minutes?: number;
}

interface UpdateSignalInput {
  name?: string;
  description?: string;
  definition?: unknown;
  webhook_url?: string;
  cooldown_minutes?: number;
  is_active?: boolean;
  [key: string]: unknown;
}

export class SignalRepository {
  async create(signal: CreateSignalInput) {
    const query = `
      INSERT INTO signals (user_id, name, description, definition, webhook_url, cooldown_minutes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      signal.user_id,
      signal.name,
      signal.description,
      JSON.stringify(signal.definition),
      signal.webhook_url,
      signal.cooldown_minutes,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async list(userId: string, activeOnly = false) {
    const query = activeOnly
      ? "SELECT * FROM signals WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC"
      : "SELECT * FROM signals WHERE user_id = $1 ORDER BY created_at DESC";
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  async getById(userId: string, id: string) {
    const { rows } = await pool.query("SELECT * FROM signals WHERE id = $1 AND user_id = $2", [
      id,
      userId,
    ]);
    return rows[0];
  }

  async update(userId: string, id: string, updates: UpdateSignalInput) {
    const fields = Object.keys(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const values = fields.map((f) =>
      f === "definition" ? JSON.stringify(updates[f]) : updates[f],
    );

    const query = `
      UPDATE signals 
      SET ${setClause}, updated_at = NOW() 
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const { rows } = await pool.query(query, [id, userId, ...values]);
    return rows[0];
  }

  async delete(userId: string, id: string) {
    await pool.query("DELETE FROM signals WHERE id = $1 AND user_id = $2", [id, userId]);
    return { deleted: true, id };
  }

  async updateEvaluatedAt(id: string) {
    const query = "UPDATE signals SET last_evaluated_at = NOW() WHERE id = $1";
    await pool.query(query, [id]);
  }

  async updateTriggeredAt(id: string) {
    const query = "UPDATE signals SET last_triggered_at = NOW() WHERE id = $1";
    await pool.query(query, [id]);
  }

  async getSignalsDueForEvaluation(intervalSeconds: number) {
    const query = `
      SELECT * FROM signals 
      WHERE is_active = true 
        AND (last_evaluated_at IS NULL 
             OR last_evaluated_at < NOW() - INTERVAL '1 second' * $1)
      ORDER BY last_evaluated_at ASC NULLS FIRST
    `;
    const { rows } = await pool.query(query, [intervalSeconds]);
    return rows;
  }
}

// ============================================================================
// NOTIFICATION LOG REPOSITORY
// ============================================================================
export interface NotificationLogEntry {
  signal_id: string;
  triggered_at: Date;
  payload: object;
  webhook_status?: number;
  error_message?: string;
  evaluation_duration_ms?: number;
  delivery_duration_ms?: number;
}

export class NotificationLogRepository {
  async create(entry: NotificationLogEntry) {
    const query = `
      INSERT INTO notification_log 
        (signal_id, triggered_at, payload, webhook_status, error_message, evaluation_duration_ms, delivery_duration_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      entry.signal_id,
      entry.triggered_at,
      JSON.stringify(entry.payload),
      entry.webhook_status,
      entry.error_message,
      entry.evaluation_duration_ms,
      entry.delivery_duration_ms,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async getBySignalId(signalId: string, limit = 50) {
    const query = `
      SELECT * FROM notification_log 
      WHERE signal_id = $1 
      ORDER BY triggered_at DESC 
      LIMIT $2
    `;
    const { rows } = await pool.query(query, [signalId, limit]);
    return rows;
  }

  async getFailedNotifications(limit = 100) {
    const query = `
      SELECT * FROM notification_log 
      WHERE webhook_status IS NULL OR webhook_status >= 400
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const { rows } = await pool.query(query, [limit]);
    return rows;
  }

  async updateDeliveryStatus(
    id: string,
    status: number,
    errorMessage?: string,
    durationMs?: number,
  ) {
    const query = `
      UPDATE notification_log 
      SET webhook_status = $2, 
          error_message = $3, 
          delivery_duration_ms = $4,
          delivered_at = CASE WHEN $2 < 400 THEN NOW() ELSE delivered_at END,
          retry_count = retry_count + 1
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query(query, [id, status, errorMessage, durationMs]);
    return rows[0];
  }
}

// ============================================================================
// AUTH REPOSITORIES
// ============================================================================

export interface UserRecord {
  id: string;
  name: string | null;
  created_at: string;
}

export class UserRepository {
  async create(name?: string | null): Promise<UserRecord> {
    const query = `
      INSERT INTO users (name)
      VALUES ($1)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [name ?? null]);
    return rows[0];
  }
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  key_hash: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at?: string | null;
}

export class ApiKeyRepository {
  async create(userId: string, keyHash: string, name?: string | null): Promise<ApiKeyRecord> {
    const query = `
      INSERT INTO api_keys (user_id, key_hash, name)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const { rows } = await pool.query(query, [userId, keyHash, name ?? null]);
    return rows[0];
  }

  async getByHash(keyHash: string): Promise<ApiKeyRecord | undefined> {
    const { rows } = await pool.query("SELECT * FROM api_keys WHERE key_hash = $1", [keyHash]);
    return rows[0];
  }

  async touchLastUsed(id: string): Promise<void> {
    await pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [id]);
  }
}

// ============================================================================
// SNAPSHOT BLOCKS REPOSITORY
// ============================================================================
export interface SnapshotBlock {
  chain_id: number;
  target_timestamp: Date;
  block_number: bigint;
  block_timestamp: Date;
}

export class SnapshotBlocksRepository {
  /**
   * Get cached block number for a given chain and timestamp
   */
  async getByTimestamp(chainId: number, targetTimestamp: Date): Promise<SnapshotBlock | null> {
    const query = `
      SELECT * FROM snapshot_blocks 
      WHERE chain_id = $1 AND target_timestamp = $2
    `;
    const { rows } = await pool.query(query, [chainId, targetTimestamp]);
    return rows[0] || null;
  }

  /**
   * Get the closest cached block at or before a given timestamp
   */
  async getClosestBefore(chainId: number, targetTimestamp: Date): Promise<SnapshotBlock | null> {
    const query = `
      SELECT * FROM snapshot_blocks 
      WHERE chain_id = $1 AND target_timestamp <= $2
      ORDER BY target_timestamp DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(query, [chainId, targetTimestamp]);
    return rows[0] || null;
  }

  /**
   * Store a resolved block snapshot
   */
  async upsert(snapshot: SnapshotBlock) {
    const query = `
      INSERT INTO snapshot_blocks (chain_id, target_timestamp, block_number, block_timestamp)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (chain_id, target_timestamp) 
      DO UPDATE SET 
        block_number = EXCLUDED.block_number,
        block_timestamp = EXCLUDED.block_timestamp,
        resolved_at = NOW()
      RETURNING *
    `;
    const values = [
      snapshot.chain_id,
      snapshot.target_timestamp,
      snapshot.block_number,
      snapshot.block_timestamp,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  /**
   * Batch insert multiple snapshots
   */
  async bulkUpsert(snapshots: SnapshotBlock[]) {
    if (snapshots.length === 0) return [];

    const values: (number | bigint | Date)[] = [];
    const placeholders = snapshots.map((s, i) => {
      const base = i * 4;
      values.push(s.chain_id, s.target_timestamp, s.block_number, s.block_timestamp);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });

    const query = `
      INSERT INTO snapshot_blocks (chain_id, target_timestamp, block_number, block_timestamp)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (chain_id, target_timestamp) 
      DO UPDATE SET 
        block_number = EXCLUDED.block_number,
        block_timestamp = EXCLUDED.block_timestamp,
        resolved_at = NOW()
      RETURNING *
    `;
    const { rows } = await pool.query(query, values);
    return rows;
  }

  /**
   * Clean up old snapshots (optional - for maintenance)
   */
  async cleanupOlderThan(days: number) {
    const query = `
      DELETE FROM snapshot_blocks 
      WHERE resolved_at < NOW() - INTERVAL '1 day' * $1
      RETURNING id
    `;
    const { rows } = await pool.query(query, [days]);
    return rows.length;
  }
}

// ============================================================================
// EVALUATION CACHE REPOSITORY
// ============================================================================
export interface CacheEntry {
  cache_key: string;
  chain_id: number;
  query_type: string;
  query_params: object;
  result: object;
  expires_at: Date;
}

export class EvaluationCacheRepository {
  async get(cacheKey: string): Promise<CacheEntry | null> {
    const query = `
      SELECT * FROM evaluation_cache 
      WHERE cache_key = $1 AND expires_at > NOW()
    `;
    const { rows } = await pool.query(query, [cacheKey]);
    return rows[0] || null;
  }

  async set(entry: CacheEntry) {
    const query = `
      INSERT INTO evaluation_cache (cache_key, chain_id, query_type, query_params, result, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (cache_key) 
      DO UPDATE SET 
        result = EXCLUDED.result,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
      RETURNING *
    `;
    const values = [
      entry.cache_key,
      entry.chain_id,
      entry.query_type,
      JSON.stringify(entry.query_params),
      JSON.stringify(entry.result),
      entry.expires_at,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async delete(cacheKey: string) {
    await pool.query("DELETE FROM evaluation_cache WHERE cache_key = $1", [cacheKey]);
  }

  async cleanup() {
    const { rows } = await pool.query("SELECT cleanup_expired_cache() as deleted_count");
    return rows[0]?.deleted_count || 0;
  }
}

// Export singleton instances
export const signalRepository = new SignalRepository();
export const notificationLogRepository = new NotificationLogRepository();
export const snapshotBlocksRepository = new SnapshotBlocksRepository();
export const evaluationCacheRepository = new EvaluationCacheRepository();
