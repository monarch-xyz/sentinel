/**
 * BullMQ-based scheduler for signal evaluation
 * Uses repeatable jobs instead of node-cron for better reliability
 */

import { Queue, Worker, Job } from 'bullmq';
import { pool } from '../db/index.js';
import { signalQueue, QUEUE_NAME as SIGNAL_QUEUE_NAME } from './processor.js';
import { connection } from './connection.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('worker:scheduler');

export const SCHEDULER_QUEUE_NAME = 'signal-scheduler';

// Queue for the scheduler itself
export const schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, { connection });

/**
 * Queue all active signals for evaluation
 */
export const queueActiveSignals = async (): Promise<number> => {
  const { rows } = await pool.query('SELECT id FROM signals WHERE is_active = true');
  
  for (const row of rows) {
    await signalQueue.add('evaluate', { signalId: row.id }, {
      removeOnComplete: true,
      removeOnFail: { count: 1000 },
    });
  }
  
  return rows.length;
};

/**
 * Setup the scheduler worker that processes the repeatable job
 */
export const setupSchedulerWorker = () => {
  const worker = new Worker(SCHEDULER_QUEUE_NAME, async (job: Job) => {
    logger.debug('Scheduler tick: Checking active signals');
    
    try {
      const count = await queueActiveSignals();
      logger.debug({ count }, 'Added signals to queue');
      return { queued: count };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Scheduler failed to fetch signals');
      throw error;
    }
  }, { connection });

  worker.on('completed', (job, result) => {
    logger.debug({ jobId: job.id, result }, 'Scheduler job completed');
  });
  
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'Scheduler job failed');
  });

  return worker;
};

/**
 * Start the scheduler by adding a repeatable job
 */
export const startScheduler = async () => {
  const intervalMs = config.worker.intervalSeconds * 1000;
  
  logger.info({ intervalSeconds: config.worker.intervalSeconds }, 'Starting signal scheduler');

  // Remove any existing repeatable jobs to avoid duplicates
  const existingJobs = await schedulerQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await schedulerQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable job that runs every intervalSeconds
  await schedulerQueue.add(
    'check-signals',
    {},
    {
      repeat: {
        every: intervalMs,
      },
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    }
  );

  logger.info('Scheduler repeatable job registered');
};
