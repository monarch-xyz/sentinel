import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { sendAlert } from "../bot/index.js";
import * as repo from "../db/repository.js";
import { verifyWebhookSignature } from "../utils/crypto.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

export const api = new Hono();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLinkPage(token: string, appUserId: string): string {
  const safeToken = escapeHtml(token);
  const safeAppUserId = escapeHtml(appUserId);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect Telegram - Sentinel</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: radial-gradient(circle at 20% 10%, #f2f8ff 0%, #f8fbff 40%, #eef3f9 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 520px;
        background: #ffffff;
        border: 1px solid #dbe4ee;
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(23, 42, 69, 0.08);
        padding: 24px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
        color: #112134;
      }
      p {
        margin: 0 0 16px;
        color: #42576f;
        line-height: 1.5;
      }
      label {
        display: block;
        font-size: 13px;
        margin-bottom: 6px;
        color: #2d4258;
      }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #c8d5e2;
        margin-bottom: 14px;
        font-size: 14px;
      }
      button {
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 11px 14px;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        background: #0d6efd;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      #status {
        margin-top: 14px;
        font-size: 14px;
      }
      .ok {
        color: #0a7d28;
      }
      .err {
        color: #b00020;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Connect Telegram</h1>
      <p>Link your Telegram chat to your Sentinel app account to receive signal alerts.</p>
      <label for="token">Bot Link Token</label>
      <input id="token" value="${safeToken}" placeholder="Token from Telegram /start link" />
      <label for="appUserId">Sentinel App User ID</label>
      <input id="appUserId" value="${safeAppUserId}" placeholder="Your app account ID" />
      <button id="connectBtn" type="button">Connect Account</button>
      <div id="status"></div>
    </main>
    <script>
      const btn = document.getElementById("connectBtn");
      const status = document.getElementById("status");
      const tokenInput = document.getElementById("token");
      const appUserIdInput = document.getElementById("appUserId");

      function setStatus(message, klass) {
        status.textContent = message;
        status.className = klass;
      }

      btn.addEventListener("click", async () => {
        const token = tokenInput.value.trim();
        const appUserId = appUserIdInput.value.trim();
        if (!token || !appUserId) {
          setStatus("Token and app user ID are required.", "err");
          return;
        }

        btn.disabled = true;
        setStatus("Connecting...", "");

        try {
          const res = await fetch("/link/connect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, app_user_id: appUserId }),
          });
          const data = await res.json();
          if (!res.ok) {
            setStatus(data.error || "Failed to connect account.", "err");
          } else {
            setStatus(data.message || "Account linked successfully.", "ok");
          }
        } catch {
          setStatus("Network error while linking account.", "err");
        } finally {
          btn.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
}

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

api.get("/link", (c) => {
  const token = c.req.query("token") ?? "";
  const appUserId = c.req.query("app_user_id") ?? "";
  return c.html(renderLinkPage(token, appUserId));
});

const LinkAccountSchema = z.object({
  token: z.string().min(1),
  app_user_id: z.string().min(1).max(255),
});

api.post("/link/connect", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LinkAccountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      400,
    );
  }

  const { token, app_user_id } = parsed.data;
  const pending = await repo.getPendingLink(token);
  if (!pending) {
    return c.json({ error: "Token not found or expired" }, 404);
  }

  const user = await repo.createUserByAppUserId(
    app_user_id,
    pending.telegram_chat_id,
    pending.telegram_username,
  );
  await repo.deletePendingLink(token);

  logger.info("App account linked", {
    appUserId: user.app_user_id,
    chatId: user.telegram_chat_id,
  });

  return c.json({
    success: true,
    app_user_id: user.app_user_id,
    message: "Telegram is now linked to your Sentinel app account.",
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
  context: z.object({
    app_user_id: z.string().min(1),
    address: z.string().optional(),
    market_id: z.string().optional(),
    chain_id: z.number().optional(),
  }),
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
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const parsed = WebhookPayloadSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      400,
    );
  }

  const payload = parsed.data;
  const appUserId = payload.context.app_user_id;
  const monitoredAddress = payload.context.address ?? null;
  const user = await repo.getUserByAppUserId(appUserId);

  if (!user) {
    await repo.logDelivery({
      signalId: payload.signal_id,
      signalName: payload.signal_name,
      appUserId,
      monitoredAddress,
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
    address: monitoredAddress ?? undefined,
    marketId: payload.context.market_id,
    chainId: payload.context.chain_id,
    monarchUrl: "https://monarchlend.xyz/positions",
  });

  // Log delivery
  await repo.logDelivery({
    signalId: payload.signal_id,
    signalName: payload.signal_name,
    appUserId,
    monitoredAddress,
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
