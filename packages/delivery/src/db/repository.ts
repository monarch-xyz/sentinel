import crypto from "node:crypto";
import { type DbClient, pool } from "./client.js";

// ============ Pending Links ============

export interface PendingLink {
  token: string;
  telegram_chat_id: number;
  telegram_username: string | null;
  created_at: Date;
  expires_at: Date;
}

export async function createPendingLink(
  chatId: number,
  username: string | null,
  db: DbClient = pool,
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");

  await db.query(
    `INSERT INTO pending_links (token, telegram_chat_id, telegram_username)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO NOTHING`,
    [token, chatId, username],
  );

  return token;
}

export async function getPendingLink(
  token: string,
  db: DbClient = pool,
): Promise<PendingLink | null> {
  const result = await db.query<PendingLink>(
    `SELECT * FROM pending_links 
     WHERE token = $1 AND expires_at > NOW()`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function deletePendingLink(
  token: string,
  db: DbClient = pool,
): Promise<void> {
  await db.query("DELETE FROM pending_links WHERE token = $1", [token]);
}

// ============ Users ============

export interface User {
  id: number;
  app_user_id: string;
  telegram_chat_id: number;
  telegram_username: string | null;
  linked_at: Date;
  is_active: boolean;
}

export async function createUserByAppUserId(
  appUserId: string,
  chatId: number,
  username: string | null,
  db: DbClient = pool,
): Promise<User> {
  const normalizedUserId = appUserId.trim();
  const result = await db.query<User>(
    `INSERT INTO users (app_user_id, telegram_chat_id, telegram_username)
     VALUES ($1, $2, $3)
     ON CONFLICT (app_user_id) DO UPDATE SET
       telegram_chat_id = EXCLUDED.telegram_chat_id,
       telegram_username = EXCLUDED.telegram_username,
       is_active = true
     RETURNING *`,
    [normalizedUserId, chatId, username],
  );
  return result.rows[0];
}

export async function getUserByAppUserId(
  appUserId: string,
  db: DbClient = pool,
): Promise<User | null> {
  const result = await db.query<User>(
    "SELECT * FROM users WHERE app_user_id = $1 AND is_active = true",
    [appUserId.trim()],
  );
  return result.rows[0] ?? null;
}

export async function getUsersByChatId(
  chatId: number,
  db: DbClient = pool,
): Promise<User[]> {
  const result = await db.query<User>(
    "SELECT * FROM users WHERE telegram_chat_id = $1 AND is_active = true",
    [chatId],
  );
  return result.rows;
}

export async function unlinkUserById(
  userId: number,
  chatId: number,
  db: DbClient = pool,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE users SET is_active = false 
     WHERE id = $1 AND telegram_chat_id = $2`,
    [userId, chatId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ============ Deliveries ============

export type DeliveryStatus = "sent" | "no_user" | "failed" | "rate_limited";

export interface Delivery {
  id: number;
  signal_id: string;
  signal_name: string | null;
  app_user_id: string | null;
  monitored_address: string | null;
  telegram_chat_id: number | null;
  status: DeliveryStatus;
  error: string | null;
  payload: unknown;
  created_at: Date;
}

export async function logDelivery(
  data: {
    signalId: string;
    signalName?: string;
    appUserId?: string;
    monitoredAddress?: string | null;
    chatId?: number;
    status: DeliveryStatus;
    error?: string;
    payload?: unknown;
  },
  db: DbClient = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO deliveries (signal_id, signal_name, app_user_id, monitored_address, telegram_chat_id, status, error, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.signalId,
      data.signalName ?? null,
      data.appUserId ?? null,
      data.monitoredAddress?.toLowerCase() ?? null,
      data.chatId ?? null,
      data.status,
      data.error ?? null,
      data.payload ? JSON.stringify(data.payload) : null,
    ],
  );
}

// ============ Rate Limiting ============

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_MESSAGES_PER_WINDOW = 30;

export async function checkRateLimit(
  chatId: number,
  db: DbClient = pool,
): Promise<{ allowed: boolean; remaining: number }> {
  const windowStart = new Date(
    Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS,
  );

  const result = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (telegram_chat_id, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (telegram_chat_id, window_start)
     DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [chatId, windowStart],
  );

  const count = result.rows[0]?.count ?? 0;
  return {
    allowed: count <= MAX_MESSAGES_PER_WINDOW,
    remaining: Math.max(0, MAX_MESSAGES_PER_WINDOW - count),
  };
}

// ============ Cleanup ============

export async function cleanupExpired(db: DbClient = pool): Promise<void> {
  await db.query("SELECT cleanup_expired_tokens()");
}
