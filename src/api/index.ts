/**
 * Sentinel API Server
 */

import express from "express";
import { config } from "../config/index.js";
import { closeDb, verifyDbConnection } from "../db/index.js";
import { getSourceCapabilities, getSourceCapabilityHealth } from "../engine/source-capabilities.js";
import { getErrorMessage, toErrorWithMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";
import { authMiddleware } from "./middleware/auth.js";
import { requestLogger } from "./middleware/requestLogger.js";
import authRouter from "./routes/auth.js";
import meRouter from "./routes/me.js";
import signalsRouter from "./routes/signals.js";
import simulateRouter from "./routes/simulate.js";

const logger = createLogger("api");
const app = express();

// Middleware
app.use(express.json());
app.use(requestLogger);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    capabilities: getSourceCapabilityHealth(),
  });
});

// API Routes
app.use("/api/v1", authMiddleware);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/me", meRouter);
app.use("/api/v1/signals", signalsRouter);
app.use("/api/v1/simulate", simulateRouter);

// Error handler
app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const error = toErrorWithMessage(err);
    logger.error({ error: error.message, stack: error.stack }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  },
);

const start = async () => {
  try {
    await verifyDbConnection();
    const capabilities = getSourceCapabilities();
    const capabilityHealth = getSourceCapabilityHealth(capabilities);

    for (const family of ["state", "indexed", "raw"] as const) {
      const capability = capabilities[family];
      const health = capabilityHealth[capability.family];
      if (capability.enabled) {
        logger.info({ family: capability.family, provider: capability.provider }, health.message);
      } else {
        logger.warn(
          {
            family: capability.family,
            provider: capability.provider,
            requiredEnv: capability.requiredEnv,
          },
          health.message,
        );
      }
    }

    const port = config.api.port;
    app.listen(port, () => {
      logger.info({ port }, "Sentinel API server started");
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutting down API server...");
      await closeDb();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Failed to start API server");
    process.exit(1);
  }
};

start();
