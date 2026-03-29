import pg from "pg";
import { config } from "../config/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("db");
const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL is required in production");
}

export const pool = new Pool({
  connectionString: databaseUrl || config.database.url,
});

export async function verifyDbConnection() {
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection verified");
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Database connection check failed");
    console.error("Database connection check failed:", getErrorMessage(error));
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
    const setClause = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
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
// SIGNAL RUN LOG REPOSITORY
// ============================================================================

export interface SignalRunLogEntry {
  signal_id: string;
  evaluated_at: Date;
  triggered: boolean;
  conclusive: boolean;
  in_cooldown: boolean;
  notification_attempted: boolean;
  notification_success?: boolean;
  webhook_status?: number;
  error_message?: string;
  evaluation_duration_ms?: number;
  delivery_duration_ms?: number;
  metadata?: object;
}

export class SignalRunLogRepository {
  async create(entry: SignalRunLogEntry) {
    const query = `
      INSERT INTO signal_run_log
        (
          signal_id,
          evaluated_at,
          triggered,
          conclusive,
          in_cooldown,
          notification_attempted,
          notification_success,
          webhook_status,
          error_message,
          evaluation_duration_ms,
          delivery_duration_ms,
          metadata
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const values = [
      entry.signal_id,
      entry.evaluated_at,
      entry.triggered,
      entry.conclusive,
      entry.in_cooldown,
      entry.notification_attempted,
      entry.notification_success,
      entry.webhook_status,
      entry.error_message,
      entry.evaluation_duration_ms,
      entry.delivery_duration_ms,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async getBySignalId(signalId: string, limit = 100) {
    const query = `
      SELECT * FROM signal_run_log
      WHERE signal_id = $1
      ORDER BY evaluated_at DESC
      LIMIT $2
    `;
    const { rows } = await pool.query(query, [signalId, limit]);
    return rows;
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

  async getById(id: string): Promise<UserRecord | undefined> {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
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

export interface AuthIdentityRecord {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface FindOrCreateIdentityInput {
  provider: string;
  providerSubject: string;
  metadata?: Record<string, unknown>;
  userName?: string | null;
}

export class AuthIdentityRepository {
  async listByUserId(userId: string): Promise<AuthIdentityRecord[]> {
    const { rows } = await pool.query(
      "SELECT * FROM auth_identities WHERE user_id = $1 ORDER BY created_at ASC",
      [userId],
    );
    return rows;
  }

  async findByProviderSubject(
    provider: string,
    providerSubject: string,
  ): Promise<AuthIdentityRecord | undefined> {
    const { rows } = await pool.query(
      "SELECT * FROM auth_identities WHERE provider = $1 AND provider_subject = $2",
      [provider, providerSubject],
    );
    return rows[0];
  }

  async findUserByProviderSubject(
    provider: string,
    providerSubject: string,
  ): Promise<UserRecord | undefined> {
    const { rows } = await pool.query(
      `SELECT users.*
       FROM auth_identities
       INNER JOIN users ON users.id = auth_identities.user_id
       WHERE auth_identities.provider = $1 AND auth_identities.provider_subject = $2`,
      [provider, providerSubject],
    );
    return rows[0];
  }

  async findOrCreateUser(
    input: FindOrCreateIdentityInput,
  ): Promise<{ user: UserRecord; identity: AuthIdentityRecord; created: boolean }> {
    const existingIdentity = await this.findByProviderSubject(
      input.provider,
      input.providerSubject,
    );
    const existingUser = existingIdentity
      ? await this.findUserByProviderSubject(input.provider, input.providerSubject)
      : undefined;

    if (existingIdentity && existingUser) {
      return { user: existingUser, identity: existingIdentity, created: false };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const freshExistingIdentity = await client.query<AuthIdentityRecord>(
        "SELECT * FROM auth_identities WHERE provider = $1 AND provider_subject = $2",
        [input.provider, input.providerSubject],
      );

      if (freshExistingIdentity.rows[0]) {
        const freshUser = await client.query<UserRecord>("SELECT * FROM users WHERE id = $1", [
          freshExistingIdentity.rows[0].user_id,
        ]);
        await client.query("COMMIT");

        if (!freshUser.rows[0]) {
          throw new Error("Identity exists without a linked user");
        }

        return {
          user: freshUser.rows[0],
          identity: freshExistingIdentity.rows[0],
          created: false,
        };
      }

      const userResult = await client.query<UserRecord>(
        `
          INSERT INTO users (name)
          VALUES ($1)
          RETURNING *
        `,
        [input.userName ?? null],
      );

      const identityResult = await client.query<AuthIdentityRecord>(
        `
          INSERT INTO auth_identities (user_id, provider, provider_subject, metadata)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (provider, provider_subject) DO NOTHING
          RETURNING *
        `,
        [
          userResult.rows[0].id,
          input.provider,
          input.providerSubject,
          JSON.stringify(input.metadata ?? {}),
        ],
      );

      if (!identityResult.rows[0]) {
        await client.query("ROLLBACK");

        const raceIdentity = await this.findByProviderSubject(
          input.provider,
          input.providerSubject,
        );
        const raceUser = await this.findUserByProviderSubject(
          input.provider,
          input.providerSubject,
        );
        if (!raceIdentity || !raceUser) {
          throw new Error("Failed to resolve identity after unique conflict");
        }

        return {
          user: raceUser,
          identity: raceIdentity,
          created: false,
        };
      }

      await client.query("COMMIT");
      return {
        user: userResult.rows[0],
        identity: identityResult.rows[0],
        created: true,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failures, the original error is more useful
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export interface UserSessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string;
  revoked_at: string | null;
}

export class UserSessionRepository {
  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<UserSessionRecord> {
    const { rows } = await pool.query(
      `
        INSERT INTO user_sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [userId, tokenHash, expiresAt],
    );
    return rows[0];
  }

  async getActiveByHash(tokenHash: string): Promise<UserSessionRecord | undefined> {
    const { rows } = await pool.query(
      `
        SELECT *
        FROM user_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
      `,
      [tokenHash],
    );
    return rows[0];
  }

  async touchLastUsed(id: string): Promise<void> {
    await pool.query("UPDATE user_sessions SET last_used_at = NOW() WHERE id = $1", [id]);
  }

  async revoke(id: string): Promise<void> {
    await pool.query(
      `
        UPDATE user_sessions
        SET revoked_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL
      `,
      [id],
    );
  }
}

export interface AuthNonceRecord {
  id: string;
  provider: string;
  nonce: string;
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
}

export class AuthNonceRepository {
  async create(provider: string, nonce: string, expiresAt: Date): Promise<AuthNonceRecord> {
    const { rows } = await pool.query(
      `
        INSERT INTO auth_nonces (provider, nonce, expires_at)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [provider, nonce, expiresAt],
    );
    return rows[0];
  }

  async consume(provider: string, nonce: string): Promise<AuthNonceRecord | undefined> {
    const { rows } = await pool.query(
      `
        UPDATE auth_nonces
        SET consumed_at = NOW()
        WHERE provider = $1
          AND nonce = $2
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING *
      `,
      [provider, nonce],
    );
    return rows[0];
  }
}

// Export singleton instances
export const signalRepository = new SignalRepository();
export const notificationLogRepository = new NotificationLogRepository();
export const signalRunLogRepository = new SignalRunLogRepository();
export const authIdentityRepository = new AuthIdentityRepository();
export const userSessionRepository = new UserSessionRepository();
export const authNonceRepository = new AuthNonceRepository();
