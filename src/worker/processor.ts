import { Queue, Worker, Job } from 'bullmq';
import { pool } from '../db/index.js';
import { SignalEvaluator } from '../engine/condition.js';
import { createMorphoFetcher } from '../engine/morpho-fetcher.js';
import { EnvioClient } from '../envio/client.js';
import { dispatchNotification } from './notifier.js';
import { connection } from './connection.js';
import pino from 'pino';

const logger = (pino as any)() as pino.Logger;

export const QUEUE_NAME = 'signal-evaluation';

export const signalQueue = new Queue(QUEUE_NAME, { connection });

export const setupWorker = () => {
  const envio = new EnvioClient();
  // Note: chainId is resolved per-signal in the evaluate() method
  // We create a default fetcher here; the SignalEvaluator will use the signal's chain
  const fetcher = createMorphoFetcher(envio, { chainId: 1 });
  const evaluator = new SignalEvaluator(fetcher);

  const worker = new Worker(QUEUE_NAME, async (job: Job) => {
    const { signalId } = job.data;
    logger.info({ signalId }, 'Evaluating signal');

    try {
      const { rows } = await pool.query('SELECT * FROM signals WHERE id = $1', [signalId]);
      const signal = rows[0];
      if (!signal || !signal.is_active) return;

      const result = await evaluator.evaluate(signal);
      
      if (result.triggered) {
        logger.info({ signalId }, 'Signal triggered! Sending notification');
        
        const now = Date.now();
        const lastTriggered = signal.last_triggered_at ? new Date(signal.last_triggered_at).getTime() : 0;
        const cooldownMs = (signal.cooldown_minutes || 5) * 60000;

        if (now - lastTriggered > cooldownMs) {
          const payload = {
            signal_id: signal.id,
            signal_name: signal.name,
            triggered_at: new Date(result.timestamp).toISOString(),
            scope: signal.definition.chains,
            conditions_met: [], 
            context: {}
          };

          const notifyResult = await dispatchNotification(signal.webhook_url, payload as any);
          
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
