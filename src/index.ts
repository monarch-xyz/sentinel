import express from "express";
import signalRoutes from "./api/routes/signals.js";
import simulateRoutes from "./api/routes/simulate.js";
import { config } from "./config/index.js";
import { initDb } from "./db/index.js";
import { getErrorMessage } from "./utils/errors.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("api");
const app = express();

app.use(express.json());

// API Routes
app.use("/api/v1/signals", signalRoutes);
app.use("/api/v1/signals", simulateRoutes);

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", version: "0.1.0" });
});

// Initialize and Start
const start = async () => {
  try {
    if (process.env.NODE_ENV !== "test") {
      await initDb();
    }

    app.listen(config.api.port, config.api.host, () => {
      logger.info(`Sentinel API running on http://${config.api.host}:${config.api.port}`);
    });
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Failed to start server");
    process.exit(1);
  }
};

start();
