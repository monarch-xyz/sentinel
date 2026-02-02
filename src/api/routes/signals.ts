import express from 'express';
import { SignalRepository } from '../../db/index.js';
import { CreateSignalSchema } from '../validators.js';
import pino from 'pino';

const logger = pino();
const router = express.Router();
const repo = new SignalRepository();

// Create Signal
router.post('/', async (req, res) => {
  try {
    const validated = CreateSignalSchema.parse(req.body);
    const signal = await repo.create(validated);
    res.status(201).json(signal);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
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
    res.json(signals);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Signal
router.get('/:id', async (req, res) => {
  try {
    const signal = await repo.getById(req.params.id);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    res.json(signal);
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

export default router;
