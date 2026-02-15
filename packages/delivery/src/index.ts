import { serve } from "@hono/node-server";
import { api } from "./api/index.js";
import { bot } from "./bot/index.js";
import { pool } from "./db/client.js";
import { cleanupExpired } from "./db/repository.js";
import { env } from "./utils/env.js";
import { logger } from "./utils/logger.js";

async function main() {
  // Test database connection
  try {
    await pool.query("SELECT 1");
    logger.info("Database connected");
  } catch (error) {
    logger.error("Database connection failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    process.exit(1);
  }

  // Start cleanup interval (every 5 minutes)
  setInterval(
    async () => {
      try {
        await cleanupExpired();
        logger.debug("Cleanup completed");
      } catch (error) {
        logger.warn("Cleanup failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    },
    5 * 60 * 1000,
  );

  // Start Telegram bot (long polling in dev, webhook in prod could be added later)
  bot.start({
    onStart: (botInfo) => {
      logger.info(`Bot started: @${botInfo.username}`);
    },
  });

  // Start HTTP server
  serve(
    {
      fetch: api.fetch,
      hostname: env.HOST,
      port: env.PORT,
    },
    (info) => {
      logger.info(
        `API server listening on http://${info.address}:${info.port}`,
      );
    },
  );

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await bot.stop();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
