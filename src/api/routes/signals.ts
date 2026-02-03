import express from 'express';
import { SignalRepository } from '../../db/index.js';
import { CreateSignalSchema, UpdateSignalSchema } from '../validators.js';
import { compileSignalDefinition } from '../../engine/compile-signal.js';
import { ValidationError } from '../../utils/validation.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('api:signals');
const router: express.Router = express.Router();
const repo = new SignalRepository();

function parseDefinition(definition: unknown): unknown {
  if (typeof definition !== 'string') return definition;
  try {
    return JSON.parse(definition);
  } catch {
    return definition;
  }
}

function formatSignalForResponse(signal: any) {
  const rawDefinition = parseDefinition(signal.definition);
  const definition =
    rawDefinition && typeof rawDefinition === 'object' && 'dsl' in (rawDefinition as any)
      ? (rawDefinition as any).dsl
      : rawDefinition;

  return {
    ...signal,
    definition,
  };
}

// Create Signal
router.post('/', async (req, res) => {
  try {
    const validated = CreateSignalSchema.parse(req.body);
    const compiled = compileSignalDefinition(validated.definition);
    const signal = await repo.create({ ...validated, definition: compiled });
    res.status(201).json(formatSignalForResponse(signal));
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message, field: error.field });
    }
    logger.error({ error: error.message }, 'Failed to create signal');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List Signals
router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.active === 'true';
    const signals = await repo.list(activeOnly);
    res.json(signals.map(formatSignalForResponse));
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Signal
router.get('/:id', async (req, res) => {
  try {
    const signal = await repo.getById(req.params.id);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    res.json(formatSignalForResponse(signal));
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete Signal
router.delete('/:id', async (req, res) => {
  try {
    const result = await repo.delete(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Signal (partial)
router.patch('/:id', async (req, res) => {
  try {
    const validated = UpdateSignalSchema.parse(req.body);
    const payload = validated.definition
      ? { ...validated, definition: compileSignalDefinition(validated.definition) }
      : validated;
    const signal = await repo.update(req.params.id, payload);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    res.json(formatSignalForResponse(signal));
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message, field: error.field });
    }
    logger.error({ error: error.message }, 'Failed to update signal');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle Signal Active Status
router.patch('/:id/toggle', async (req, res) => {
  try {
    const existing = await repo.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Signal not found' });

    const signal = await repo.update(req.params.id, { is_active: !existing.is_active });
    res.json(formatSignalForResponse(signal));
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to toggle signal');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
