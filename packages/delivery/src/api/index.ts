import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { sendAlert } from "../bot/index.js";
import * as repo from "../db/repository.js";
import {
  generateLinkMessage,
  verifyWalletSignature,
  verifyWebhookSignature,
} from "../utils/crypto.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

export const api = new Hono();

// ============ Middleware ============

api.use(
  "*",
  cors({
    origin: [
      "https://monarchlend.xyz",
      "https://sentinel.monarchlend.xyz",
      "http://localhost:3000",
    ],
    credentials: true,
  }),
);

api.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.debug(`${c.req.method} ${c.req.path}`, {
    status: c.res.status,
    duration,
  });
});

// ============ Health Check ============

api.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============ Link Endpoints ============

// GET /link/message - Get the message to sign for a token
const GetMessageSchema = z.object({
  token: z.string().min(1),
});

api.get("/link/message", async (c) => {
  const query = GetMessageSchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: "Invalid token" }, 400);
  }

  const pending = await repo.getPendingLink(query.data.token);
  if (!pending) {
    return c.json({ error: "Token not found or expired" }, 404);
  }

  const message = generateLinkMessage(query.data.token);
  return c.json({ message });
});

// POST /link/verify - Verify signature and link wallet
const VerifyLinkSchema = z.object({
  token: z.string().min(1),
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

api.post("/link/verify", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = VerifyLinkSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400,
    );
  }

  const { token, wallet, signature } = parsed.data;

  // Check token exists
  const pending = await repo.getPendingLink(token);
  if (!pending) {
    return c.json({ error: "Token not found or expired" }, 404);
  }

  // Verify signature
  const message = generateLinkMessage(token);
  const valid = await verifyWalletSignature(
    wallet,
    message,
    signature as `0x${string}`,
  );

  if (!valid) {
    logger.warn("Invalid signature", { wallet, token });
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Create user
  const user = await repo.createUser(
    wallet,
    pending.telegram_chat_id,
    pending.telegram_username,
  );

  // Clean up pending link
  await repo.deletePendingLink(token);

  logger.info("Wallet linked", {
    wallet: user.wallet,
    chatId: user.telegram_chat_id,
  });

  return c.json({
    success: true,
    wallet: user.wallet,
    message: "Wallet linked successfully! You will now receive alerts.",
  });
});

// ============ Webhook Endpoint ============

// Sentinel webhook payload schema
const WebhookPayloadSchema = z.object({
  signal_id: z.string(),
  signal_name: z.string().optional(),
  triggered_at: z.string(),
  conditions_met: z.union([z.number(), z.array(z.unknown())]).optional(),
  summary: z.string().optional(),
  context: z
    .object({
      wallet: z.string().optional(),
      address: z.string().optional(), // Some signals use "address" instead
      market_id: z.string().optional(),
      chain_id: z.number().optional(),
    })
    .optional(),
});

api.post("/webhook/deliver", async (c) => {
  // Verify signature
  const signature = c.req.header("X-Sentinel-Signature");
  const body = await c.req.text();

  if (!signature) {
    logger.warn("Missing webhook signature");
    return c.json({ error: "Missing signature" }, 401);
  }

  if (!verifyWebhookSignature(body, signature)) {
    logger.warn("Invalid webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse payload
  const parsed = WebhookPayloadSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      400,
    );
  }

  const payload = parsed.data;
  const wallet = payload.context?.wallet ?? payload.context?.address;

  if (!wallet) {
    // Log but don't fail - some signals might not have a wallet
    await repo.logDelivery({
      signalId: payload.signal_id,
      signalName: payload.signal_name,
      wallet: "unknown",
      status: "no_user",
      payload: payload,
    });
    return c.json({ delivered: false, reason: "No wallet in payload" });
  }

  // Find user
  const user = await repo.getUserByWallet(wallet);
  if (!user) {
    await repo.logDelivery({
      signalId: payload.signal_id,
      signalName: payload.signal_name,
      wallet,
      status: "no_user",
      payload: payload,
    });
    return c.json({ delivered: false, reason: "User not found" });
  }

  const conditionsMetCount = Array.isArray(payload.conditions_met)
    ? payload.conditions_met.length
    : payload.conditions_met;
  const fallbackSummary =
    typeof conditionsMetCount === "number"
      ? `${conditionsMetCount} condition${conditionsMetCount === 1 ? "" : "s"} met at ${payload.triggered_at}`
      : `Triggered at ${payload.triggered_at}`;

  // Send alert
  const success = await sendAlert(user.telegram_chat_id, {
    signalName: payload.signal_name ?? "Signal Alert",
    summary: payload.summary ?? fallbackSummary,
    wallet,
    marketId: payload.context?.market_id,
    chainId: payload.context?.chain_id,
    monarchUrl: "https://monarchlend.xyz/positions",
  });

  // Log delivery
  await repo.logDelivery({
    signalId: payload.signal_id,
    signalName: payload.signal_name,
    wallet,
    chatId: user.telegram_chat_id,
    status: success ? "sent" : "failed",
    payload: payload,
  });

  return c.json({ delivered: success });
});

// ============ Admin Endpoints (protected) ============

api.get("/admin/stats", async (c) => {
  // Simple auth via header for now
  const authKey = c.req.header("X-Admin-Key");
  if (authKey !== env.WEBHOOK_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Get basic stats
  const { pool } = await import("../db/client.js");

  const [users, deliveries, recentDeliveries] = await Promise.all([
    pool.query("SELECT COUNT(*) as count FROM users WHERE is_active = true"),
    pool.query("SELECT COUNT(*) as count FROM deliveries"),
    pool.query(`
      SELECT status, COUNT(*) as count 
      FROM deliveries 
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY status
    `),
  ]);

  return c.json({
    users: Number.parseInt(users.rows[0].count),
    total_deliveries: Number.parseInt(deliveries.rows[0].count),
    last_24h: recentDeliveries.rows,
  });
});
