import cron from 'node-cron';
import { pool } from '../db/index.js';
import { signalQueue } from './processor.js';
import pino from 'pino';

const logger = pino();

/**
 * Scheduler Logic: Periodically scans DB and adds signals to the queue
 */
export const startScheduler = () => {
  logger.info('Starting signal scheduler (30s interval)');

  // Run every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    logger.debug('Scheduler tick: Checking active signals');
    
    try {
      const { rows } = await pool.query('SELECT id FROM signals WHERE is_active = true');
      
      for (const row of rows) {
        await signalQueue.add('evaluate', { signalId: row.id }, {
          removeOnComplete: true,
          removeOnFail: { count: 1000 },
        });
      }
      
      logger.debug({ count: rows.length }, 'Added signals to queue');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Scheduler failed to fetch signals');
    }
  });
};
