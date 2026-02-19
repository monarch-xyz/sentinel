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

interface WorkerSignalRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  definition: unknown;
  webhook_url: string;
  cooldown_minutes: number;
  is_active: boolean;
  last_triggered_at: string | Date | null;
  last_evaluated_at: string | Date | null;
}

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
      const jobStartedAt = Date.now();
      let signal: WorkerSignalRow | undefined;

      try {
        const { rows } = await pool.query("SELECT * FROM signals WHERE id = $1", [signalId]);
        signal = rows[0] as WorkerSignalRow | undefined;
        if (!signal || !signal.is_active) return;

        const rawDefinition =
          typeof signal.definition === "string" ? JSON.parse(signal.definition) : signal.definition;
        const storedDefinition = normalizeStoredDefinition(rawDefinition);
        const evalSignal: EvaluatableSignal = {
          id: signal.id,
          name: signal.name,
          description: signal.description ?? undefined,
          chains: storedDefinition.ast.chains,
          window: storedDefinition.ast.window,
          conditions: storedDefinition.ast.conditions,
          logic: storedDefinition.ast.logic,
          webhook_url: signal.webhook_url,
          cooldown_minutes: signal.cooldown_minutes,
          is_active: signal.is_active,
          last_triggered_at: signal.last_triggered_at ?? undefined,
          last_evaluated_at: signal.last_evaluated_at ?? undefined,
        };

        const evalStart = Date.now();
        const result = await evaluator.evaluate(evalSignal);
        const evaluationDurationMs = Date.now() - evalStart;
        const evaluatedAt = new Date(result.timestamp);
        const scope = storedDefinition.dsl?.scope ?? { chains: storedDefinition.ast.chains };

        let inCooldown = false;
        let notificationAttempted = false;
        let notificationSuccess: boolean | undefined;
        let webhookStatus: number | undefined;
        let deliveryDurationMs: number | undefined;
        let notificationError: string | undefined;
        let retryCount = 0;

        if (result.triggered) {
          logger.info({ signalId }, "Signal triggered! Sending notification");

          const now = Date.now();
          const lastTriggered = signal.last_triggered_at
            ? new Date(signal.last_triggered_at).getTime()
            : 0;
          const cooldownMs = (signal.cooldown_minutes || 5) * 60000;

          if (now - lastTriggered > cooldownMs) {
            notificationAttempted = true;
            const primaryAddress = scope.addresses?.[0];
            const primaryMarket = scope.markets?.[0];
            const primaryChain = scope.chains[0];
            const context: WebhookPayload["context"] = {
              app_user_id: signal.user_id,
            };
            if (primaryAddress) {
              context.address = primaryAddress;
            }
            if (primaryMarket) {
              context.market_id = primaryMarket;
            }
            if (typeof primaryChain === "number") {
              context.chain_id = primaryChain;
            }
            const payload: WebhookPayload = {
              signal_id: signal.id,
              signal_name: signal.name,
              triggered_at: new Date(result.timestamp).toISOString(),
              scope,
              conditions_met: [],
              context,
            };

            const notifyResult = await dispatchNotification(signal.webhook_url, payload);
            retryCount = Math.max(0, (notifyResult.attempts ?? 1) - 1);
            notificationSuccess = notifyResult.success;
            webhookStatus = notifyResult.status;
            deliveryDurationMs = notifyResult.durationMs;
            notificationError = notifyResult.error ?? undefined;

            if (notifyResult.success) {
              await pool.query("UPDATE signals SET last_triggered_at = NOW() WHERE id = $1", [
                signalId,
              ]);
            }

            await pool.query(
              "INSERT INTO notification_log (signal_id, triggered_at, payload, webhook_status, error_message, retry_count, evaluation_duration_ms, delivery_duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
              [
                signalId,
                evaluatedAt,
                JSON.stringify(payload),
                notifyResult.status,
                notifyResult.error ?? null,
                retryCount,
                evaluationDurationMs,
                notifyResult.durationMs,
              ],
            );
          } else {
            inCooldown = true;
            logger.info({ signalId }, "Signal triggered but in cooldown");
          }
        }

        await pool.query(
          `INSERT INTO signal_run_log
            (
              signal_id,
              evaluated_at,
              triggered,
              conclusive,
              in_cooldown,
              notification_attempted,
              notification_success,
              webhook_status,
              error_message,
              evaluation_duration_ms,
              delivery_duration_ms,
              metadata
            )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            signalId,
            evaluatedAt,
            result.triggered,
            result.conclusive,
            inCooldown,
            notificationAttempted,
            notificationSuccess,
            webhookStatus,
            result.error ?? notificationError ?? null,
            evaluationDurationMs,
            deliveryDurationMs ?? null,
            JSON.stringify({
              signal_name: signal.name,
              scope,
              retry_count: retryCount,
            }),
          ],
        );

        await pool.query("UPDATE signals SET last_evaluated_at = NOW() WHERE id = $1", [signalId]);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        const evaluatedAt = new Date();
        const evaluationDurationMs = Date.now() - jobStartedAt;

        if (signal?.id) {
          try {
            await pool.query(
              `INSERT INTO signal_run_log
                (
                  signal_id,
                  evaluated_at,
                  triggered,
                  conclusive,
                  in_cooldown,
                  notification_attempted,
                  notification_success,
                  webhook_status,
                  error_message,
                  evaluation_duration_ms,
                  delivery_duration_ms,
                  metadata
                )
              VALUES ($1, $2, false, false, false, false, NULL, NULL, $3, $4, NULL, $5)`,
              [
                signal.id,
                evaluatedAt,
                errorMessage,
                evaluationDurationMs,
                JSON.stringify({
                  signal_name: signal.name,
                  stage: "worker_error",
                }),
              ],
            );

            await pool.query("UPDATE signals SET last_evaluated_at = NOW() WHERE id = $1", [
              signal.id,
            ]);
          } catch (logError: unknown) {
            logger.error(
              { signalId, error: getErrorMessage(logError) },
              "Failed to persist failed run log",
            );
          }
        }

        logger.error({ signalId, error: errorMessage }, "Worker evaluation failed");
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
