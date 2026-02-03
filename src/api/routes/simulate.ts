import express from 'express';
import { SignalRepository } from '../../db/index.js';
import { normalizeStoredDefinition } from '../../engine/compile-signal.js';
import { resolveBlockByTimestamp } from '../../envio/blocks.js';
import { parseDuration } from '../../utils/duration.js';
import { z } from 'zod';
import pino from 'pino';

const logger = (pino as any)() as pino.Logger;
const router: express.Router = express.Router();
const repo = new SignalRepository();

const SimulateSchema = z.object({
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  interval_ms: z.number().int().min(60000).default(3600000), // Default 1h steps
});

router.post('/:id/simulate', async (req, res) => {
  try {
    const { start_time, end_time, interval_ms } = SimulateSchema.parse(req.body);
    const signal = await repo.getById(req.params.id);
    
    if (!signal) return res.status(404).json({ error: 'Signal not found' });

    const storedDefinition = normalizeStoredDefinition(signal.definition);
    const compiled = storedDefinition.ast;

    const startTs = new Date(start_time).getTime();
    const endTs = new Date(end_time).getTime();
    const triggers = [];

    logger.info({ signalId: signal.id, start_time, end_time }, 'Starting simulation');

    // Simulate in steps
    for (let currentTs = startTs; currentTs <= endTs; currentTs += interval_ms) {
      // Manual context override for simulation
      const durationMs = parseDuration(compiled.window.duration);
      const windowStart = currentTs - durationMs;
      const chainId = compiled.chains[0] || 1;
      const currentBlock = await resolveBlockByTimestamp(chainId, currentTs);
      const windowStartBlock = await resolveBlockByTimestamp(chainId, windowStart);

      // Note: This is a simplified simulation loop
      // In a full impl, we'd pass a custom context to evaluator.evaluate()
      // For now, we're building the endpoint structure
      triggers.push({
        timestamp: new Date(currentTs).toISOString(),
        triggered: false, // Placeholder for actual hist evaluation
      });
    }

    res.json({
      signal_id: signal.id,
      range: { start_time, end_time },
      steps: triggers.length,
      triggers
    });

  } catch (error: any) {
    if (error.name === 'ZodError') return res.status(400).json({ error: 'Invalid range', details: error.errors });
    logger.error({ error: error.message }, 'Simulation failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
