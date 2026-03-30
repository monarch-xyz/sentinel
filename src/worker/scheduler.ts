/**
 * BullMQ-based scheduler for signal evaluation
 * Uses repeatable jobs instead of node-cron for better reliability
 */

import { type Job, Queue, Worker } from "bullmq";
import { config } from "../config/index.ts";
import { pool } from "../db/index.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { createLogger } from "../utils/logger.ts";
import { connection } from "./connection.ts";
import { QUEUE_NAME as SIGNAL_QUEUE_NAME, signalQueue } from "./processor.ts";

const logger = createLogger("worker:scheduler");

export const SCHEDULER_QUEUE_NAME = "signal-scheduler";
const SCHEDULER_JOB_ID = "signal-scheduler";

// Queue for the scheduler itself
export const schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, { connection });

/**
 * Queue all active signals for evaluation
 */
export const queueActiveSignals = async (): Promise<number> => {
  const { rows } = await pool.query("SELECT id FROM signals WHERE is_active = true");

  for (const row of rows) {
    await signalQueue.add(
      "evaluate",
      { signalId: row.id },
      {
        jobId: row.id,
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      },
    );
  }

  return rows.length;
};

/**
 * Setup the scheduler worker that processes the repeatable job
 */
export const setupSchedulerWorker = () => {
  const worker = new Worker(
    SCHEDULER_QUEUE_NAME,
    async (job: Job) => {
      logger.debug("Scheduler tick: Checking active signals");

      try {
        const count = await queueActiveSignals();
        logger.debug({ count }, "Added signals to queue");
        return { queued: count };
      } catch (error: unknown) {
        logger.error({ error: getErrorMessage(error) }, "Scheduler failed to fetch signals");
        throw error;
      }
    },
    { connection },
  );

  worker.on("completed", (job, result) => {
    logger.debug({ jobId: job.id, result }, "Scheduler job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "Scheduler job failed");
  });

  return worker;
};

/**
 * Start the scheduler by adding a repeatable job
 */
export const startScheduler = async () => {
  const intervalMs = config.worker.intervalSeconds * 1000;

  logger.info({ intervalSeconds: config.worker.intervalSeconds }, "Starting signal scheduler");

  await schedulerQueue.upsertJobScheduler(
    SCHEDULER_JOB_ID,
    {
      every: intervalMs,
    },
    {
      name: "check-signals",
      data: {},
      opts: {
        removeOnComplete: true,
        removeOnFail: { count: 100 },
      },
    },
  );

  logger.info("Scheduler repeatable job registered");
};
