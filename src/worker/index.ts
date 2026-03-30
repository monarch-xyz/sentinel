/**
 * Sentinel Worker Process
 *
 * Initializes BullMQ workers for:
 * 1. Scheduler - periodically queues active signals for evaluation
 * 2. Processor - evaluates signals and dispatches notifications
 */

import { config } from "../config/index.ts";
import { closeDb, verifyDbConnection } from "../db/index.ts";
import { getSourceCapabilities, getSourceCapabilityHealth } from "../engine/source-capabilities.ts";
import { assertRpcConfiguration, getRpcConfigurationStatus } from "../rpc/client.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { createLogger } from "../utils/logger.ts";
import { closeConnection } from "./connection.ts";
import { setupWorker } from "./processor.ts";
import { setupSchedulerWorker, startScheduler } from "./scheduler.ts";

const logger = createLogger("worker");

const start = async () => {
  try {
    logger.info("Starting Sentinel Worker process");

    assertRpcConfiguration();
    await verifyDbConnection();
    const capabilities = getSourceCapabilities();
    const capabilityHealth = getSourceCapabilityHealth(capabilities);
    const rpcStatus = getRpcConfigurationStatus();

    logger.info(
      {
        chains: rpcStatus.supportedChains.map((chain) => ({
          chainId: chain.chainId,
          name: chain.name,
          rpcEnvVar: chain.rpcEnvVar,
        })),
      },
      "Configured supported chains loaded",
    );

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

    // Setup workers
    const processorWorker = setupWorker();
    const schedulerWorker = config.worker.runScheduler ? setupSchedulerWorker() : undefined;

    if (config.worker.runScheduler) {
      await startScheduler();
      logger.info("Signal scheduler is enabled for this worker");
    } else {
      logger.info("Signal scheduler is disabled for this worker");
    }

    logger.info("Sentinel worker process is running");

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutting down workers...");

      await processorWorker.close();
      await schedulerWorker?.close();
      await closeConnection();
      await closeDb();

      logger.info("Shutdown complete");
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Failed to start worker process");
    console.error("Failed to start worker process:", getErrorMessage(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
};

start();
