import { type Job, Queue, Worker } from "bullmq";
import { pool } from "../db/index.js";
import { normalizeStoredDefinition } from "../engine/compile-signal.js";
import { type EvaluatableSignal, SignalEvaluator } from "../engine/condition.js";
import { createMorphoFetcher } from "../engine/morpho-fetcher.js";
import { EnvioClient } from "../envio/client.js";
import type { WebhookPayload } from "../types/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";
import { connection } from "./connection.js";
import { dispatchNotification } from "./notifier.js";

const logger = createLogger("worker:processor");

export const QUEUE_NAME = "signal-evaluation";

export const signalQueue = new Queue(QUEUE_NAME, { connection });

export const setupWorker = () => {
  const envio = new EnvioClient();
  // Note: chainId is resolved per-signal in the evaluate() method
  // We create a default fetcher here; the SignalEvaluator will use the signal's chain
  const fetcher = createMorphoFetcher(envio, { chainId: 1 });
  const evaluator = new SignalEvaluator(fetcher);

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { signalId } = job.data;
      logger.info({ signalId }, "Evaluating signal");

      try {
        const { rows } = await pool.query("SELECT * FROM signals WHERE id = $1", [signalId]);
        const signal = rows[0];
        if (!signal || !signal.is_active) return;

        const rawDefinition =
          typeof signal.definition === "string" ? JSON.parse(signal.definition) : signal.definition;
        const storedDefinition = normalizeStoredDefinition(rawDefinition);
        const evalSignal: EvaluatableSignal = {
          id: signal.id,
          name: signal.name,
          description: signal.description,
          chains: storedDefinition.ast.chains,
          window: storedDefinition.ast.window,
          condition: storedDefinition.ast.condition,
          conditions: storedDefinition.ast.conditions,
          logic: storedDefinition.ast.logic,
          webhook_url: signal.webhook_url,
          cooldown_minutes: signal.cooldown_minutes,
          is_active: signal.is_active,
          last_triggered_at: signal.last_triggered_at,
          last_evaluated_at: signal.last_evaluated_at,
        };

        const evalStart = Date.now();
        const result = await evaluator.evaluate(evalSignal);
        const evaluationDurationMs = Date.now() - evalStart;

        if (result.triggered) {
          logger.info({ signalId }, "Signal triggered! Sending notification");

          const now = Date.now();
          const lastTriggered = signal.last_triggered_at
            ? new Date(signal.last_triggered_at).getTime()
            : 0;
          const cooldownMs = (signal.cooldown_minutes || 5) * 60000;

          if (now - lastTriggered > cooldownMs) {
            const payload: WebhookPayload = {
              signal_id: signal.id,
              signal_name: signal.name,
              triggered_at: new Date(result.timestamp).toISOString(),
              scope: storedDefinition.dsl?.scope ?? { chains: storedDefinition.ast.chains },
              conditions_met: [],
              context: {},
            };

            const notifyResult = await dispatchNotification(signal.webhook_url, payload);
            const retryCount = Math.max(0, (notifyResult.attempts ?? 1) - 1);

            if (notifyResult.success) {
              await pool.query("UPDATE signals SET last_triggered_at = NOW() WHERE id = $1", [
                signalId,
              ]);
            }

            await pool.query(
              "INSERT INTO notification_log (signal_id, triggered_at, payload, webhook_status, error_message, retry_count, evaluation_duration_ms, delivery_duration_ms) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7)",
              [
                signalId,
                JSON.stringify(payload),
                notifyResult.status,
                notifyResult.error ?? null,
                retryCount,
                evaluationDurationMs,
                notifyResult.durationMs,
              ],
            );
          } else {
            logger.info({ signalId }, "Signal triggered but in cooldown");
          }
        }

        await pool.query("UPDATE signals SET last_evaluated_at = NOW() WHERE id = $1", [signalId]);
      } catch (error: unknown) {
        logger.error({ signalId, error: getErrorMessage(error) }, "Worker evaluation failed");
        throw error;
      }
    },
    { connection },
  );

  worker.on("completed", (job) => logger.debug({ jobId: job.id }, "Job completed"));
  worker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, error: err.message }, "Job failed"),
  );

  return worker;
};
