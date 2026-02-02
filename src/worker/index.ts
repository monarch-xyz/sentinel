import { startScheduler } from './scheduler.js';
import { setupWorker } from './processor.js';
import { initDb } from '../db/index.js';
import pino from 'pino';

const logger = pino();

const start = async () => {
  try {
    logger.info('Starting Flare Worker process');
    
    // Initialize DB connection
    await initDb();

    // Start components
    startScheduler();
    setupWorker();

    logger.info('Flare Worker & Scheduler are running');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start worker process');
    process.exit(1);
  }
};

start();
