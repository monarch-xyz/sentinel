import { Queue, Worker, Job } from 'bullmq';
import { pool } from '../db/index.js';
import { SignalEvaluator } from '../engine/condition.js';
import { EnvioClient } from '../envio/client.js';
import { dispatchNotification } from './notifier.js';
import { config } from '../config/index.js';
import pino from 'pino';
import IORedis from 'ioredis';

const logger = pino();
const connection = new IORedis(config.database.url.replace('postgresql', 'redis').split('?')[0] || 'redis://localhost:6379');

export const signalQueue = new Queue('signal-evaluation', { connection });

/**
 * Worker Logic: Evaluates a single signal
 */
export const setupWorker = () => {
  const envio = new EnvioClient();
  const evaluator = new SignalEvaluator(envio);

  const worker = new Worker('signal-evaluation', async (job: Job) => {
    const { signalId } = job.data;
    logger.info({ signalId }, 'Evaluating signal');

    try {
      // 1. Fetch signal from DB
      const { rows } = await pool.query('SELECT * FROM signals WHERE id = $1', [signalId]);
      const signal = rows[0];
      if (!signal || !signal.is_active) return;

      // 2. Evaluate
      const result = await evaluator.evaluate(signal);
      
      // 3. If triggered, notify
      if (result.triggered) {
        logger.info({ signalId }, 'Signal triggered! Sending notification');
        
        // Check cooldown
        const now = Date.now();
        const lastTriggered = signal.last_triggered_at ? new Date(signal.last_triggered_at).getTime() : 0;
        const cooldownMs = (signal.cooldown_minutes || 5) * 60000;

        if (now - lastTriggered > cooldownMs) {
          const payload = {
            signal_id: signal.id,
            signal_name: signal.name,
            triggered_at: new Date(result.timestamp).toISOString(),
            scope: signal.definition.chains,
            conditions_met: [], // Todo: include details
            context: {}
          };

          const notifyResult = await dispatchNotification(signal.webhook_url, payload as any);
          
          // 4. Log and Update last_triggered
          await pool.query(
            'UPDATE signals SET last_triggered_at = NOW() WHERE id = $1',
            [signalId]
          );

          await pool.query(
            'INSERT INTO notification_log (signal_id, triggered_at, payload, webhook_status, duration_ms) VALUES ($1, NOW(), $2, $3, $4)',
            [signalId, JSON.stringify(payload), notifyResult.status, notifyResult.durationMs]
          );
        } else {
          logger.info({ signalId }, 'Signal triggered but in cooldown');
        }
      }

      // Update last_evaluated
      await pool.query('UPDATE signals SET last_evaluated_at = NOW() WHERE id = $1', [signalId]);

    } catch (error: any) {
      logger.error({ signalId, error: error.message }, 'Worker evaluation failed');
      throw error;
    }
  }, { connection });

  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'Job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, error: err.message }, 'Job failed'));

  return worker;
};
