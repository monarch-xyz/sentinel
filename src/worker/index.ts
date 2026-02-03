/**
 * Flare Worker Process
 * 
 * Initializes BullMQ workers for:
 * 1. Scheduler - periodically queues active signals for evaluation
 * 2. Processor - evaluates signals and dispatches notifications
 */

import { startScheduler, setupSchedulerWorker } from './scheduler.js';
import { setupWorker } from './processor.js';
import { closeConnection } from './connection.js';
import { initDb, closeDb } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('worker');

const start = async () => {
  try {
    logger.info('Starting Flare Worker process');
    
    // Initialize DB connection
    await initDb();

    // Setup workers
    const processorWorker = setupWorker();
    const schedulerWorker = setupSchedulerWorker();

    // Start the scheduler (registers repeatable job)
    await startScheduler();

    logger.info('Flare Worker & Scheduler are running');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down workers...');
      
      await processorWorker.close();
      await schedulerWorker.close();
      await closeConnection();
      await closeDb();
      
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start worker process');
    process.exit(1);
  }
};

start();
