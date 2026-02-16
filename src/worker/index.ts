/**
 * Sentinel Worker Process
 *
 * Initializes BullMQ workers for:
 * 1. Scheduler - periodically queues active signals for evaluation
 * 2. Processor - evaluates signals and dispatches notifications
 */

import { closeDb, initDb } from "../db/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";
import { closeConnection } from "./connection.js";
import { setupWorker } from "./processor.js";
import { setupSchedulerWorker, startScheduler } from "./scheduler.js";

const logger = createLogger("worker");

const start = async () => {
  try {
    logger.info("Starting Sentinel Worker process");

    // Initialize DB connection
    await initDb();

    // Setup workers
    const processorWorker = setupWorker();
    const schedulerWorker = setupSchedulerWorker();

    // Start the scheduler (registers repeatable job)
    await startScheduler();

    logger.info("Sentinel Worker & Scheduler are running");

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutting down workers...");

      await processorWorker.close();
      await schedulerWorker.close();
      await closeConnection();
      await closeDb();

      logger.info("Shutdown complete");
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Failed to start worker process");
    process.exit(1);
  }
};

start();
