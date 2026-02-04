import express from "express";
import { z } from "zod";
import { SignalRepository } from "../../db/index.js";
import { normalizeStoredDefinition } from "../../engine/compile-signal.js";
import { findFirstTrigger, simulateSignalOverTime } from "../../engine/simulation.js";
import { getErrorMessage, isZodError } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";
import { rateLimit } from "../middleware/rate-limit.js";

const logger = createLogger("api:simulate");
const router: express.Router = express.Router();
const repo = new SignalRepository();
const MAX_SIMULATION_STEPS = Number.parseInt(
  process.env.MAX_SIMULATION_STEPS ?? "2000",
  10,
);
const SIMULATE_RATE_LIMIT = Number.parseInt(
  process.env.SIMULATE_RATE_LIMIT ?? "60",
  10,
);

router.use(
  rateLimit({
    windowMs: 60_000,
    max: SIMULATE_RATE_LIMIT,
  }),
);

const SimulateSchema = z.object({
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  interval_ms: z.number().int().min(60000).default(3600000), // Default 1h steps
  compact: z.boolean().optional().default(false),
});

const FirstTriggerSchema = z.object({
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  precision_ms: z.number().int().min(60000).default(60000), // Default 1m precision
});

router.post("/:id/simulate", async (req, res) => {
  try {
    const { start_time, end_time, interval_ms, compact } = SimulateSchema.parse(req.body);
    const signal = await repo.getById(req.params.id);

    if (!signal) return res.status(404).json({ error: "Signal not found" });

    const storedDefinition = normalizeStoredDefinition(signal.definition);
    const compiled = storedDefinition.ast;

    const startTs = new Date(start_time).getTime();
    const endTs = new Date(end_time).getTime();
    const chainId = compiled.chains[0] || 1;

    if (Number.isNaN(startTs) || Number.isNaN(endTs) || startTs >= endTs) {
      return res
        .status(400)
        .json({ error: "Invalid range", details: "start_time must be before end_time" });
    }

    const steps = Math.floor((endTs - startTs) / interval_ms) + 1;
    if (steps > MAX_SIMULATION_STEPS) {
      return res.status(400).json({
        error: "Range too large",
        details: `Requested ${steps} steps exceeds limit ${MAX_SIMULATION_STEPS}`,
      });
    }

    logger.info({ signalId: signal.id, start_time, end_time, interval_ms }, "Starting simulation");

    const evalSignal = {
      id: signal.id,
      name: signal.name,
      description: signal.description,
      chains: compiled.chains,
      window: compiled.window,
      condition: compiled.condition,
      conditions: compiled.conditions,
      logic: compiled.logic,
      webhook_url: signal.webhook_url,
      cooldown_minutes: signal.cooldown_minutes,
      is_active: signal.is_active,
      last_triggered_at: signal.last_triggered_at,
      last_evaluated_at: signal.last_evaluated_at,
    };

    const results = await simulateSignalOverTime(evalSignal, chainId, startTs, endTs, interval_ms);

    if (compact) {
      const triggeredTimestamps = results
        .filter((result) => result.triggered)
        .map((result) => new Date(result.evaluatedAt).toISOString());

      return res.json({
        signal_id: signal.id,
        range: { start_time, end_time },
        steps: results.length,
        triggered_count: triggeredTimestamps.length,
        triggered_timestamps: triggeredTimestamps,
      });
    }

    const triggers = results.map((result) => ({
      timestamp: new Date(result.evaluatedAt).toISOString(),
      triggered: result.triggered,
      operator: result.operator,
      left_value: result.leftValue,
      right_value: result.rightValue,
      window_start: new Date(result.windowStart).toISOString(),
      block_numbers: result.blockNumbers,
      execution_ms: result.executionTimeMs,
    }));

    res.json({
      signal_id: signal.id,
      range: { start_time, end_time },
      steps: triggers.length,
      triggers,
    });
  } catch (error: unknown) {
    if (isZodError(error))
      return res.status(400).json({ error: "Invalid range", details: error.errors });
    logger.error({ error: getErrorMessage(error) }, "Simulation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/first-trigger", async (req, res) => {
  try {
    const { start_time, end_time, precision_ms } = FirstTriggerSchema.parse(req.body);
    const signal = await repo.getById(req.params.id);

    if (!signal) return res.status(404).json({ error: "Signal not found" });

    const storedDefinition = normalizeStoredDefinition(signal.definition);
    const compiled = storedDefinition.ast;

    const startTs = new Date(start_time).getTime();
    const endTs = new Date(end_time).getTime();
    const chainId = compiled.chains[0] || 1;

    if (Number.isNaN(startTs) || Number.isNaN(endTs) || startTs >= endTs) {
      return res
        .status(400)
        .json({ error: "Invalid range", details: "start_time must be before end_time" });
    }

    logger.info(
      { signalId: signal.id, start_time, end_time, precision_ms },
      "Finding first trigger",
    );

    const evalSignal = {
      id: signal.id,
      name: signal.name,
      description: signal.description,
      chains: compiled.chains,
      window: compiled.window,
      condition: compiled.condition,
      conditions: compiled.conditions,
      logic: compiled.logic,
      webhook_url: signal.webhook_url,
      cooldown_minutes: signal.cooldown_minutes,
      is_active: signal.is_active,
      last_triggered_at: signal.last_triggered_at,
      last_evaluated_at: signal.last_evaluated_at,
    };

    const first = await findFirstTrigger(evalSignal, chainId, startTs, endTs, precision_ms);

    if (!first) {
      return res.json({
        signal_id: signal.id,
        triggered: false,
        range: { start_time, end_time },
      });
    }

    return res.json({
      signal_id: signal.id,
      triggered: true,
      first_triggered_at: new Date(first.evaluatedAt).toISOString(),
      window_start: new Date(first.windowStart).toISOString(),
      operator: first.operator,
      left_value: first.leftValue,
      right_value: first.rightValue,
      block_numbers: first.blockNumbers,
      execution_ms: first.executionTimeMs,
    });
  } catch (error: unknown) {
    if (isZodError(error))
      return res.status(400).json({ error: "Invalid range", details: error.errors });
    logger.error({ error: getErrorMessage(error) }, "First trigger search failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
