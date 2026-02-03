/**
 * Flare API Server
 */

import express from 'express';
import { config } from '../config/index.js';
import { initDb, closeDb } from '../db/index.js';
import signalsRouter from './routes/signals.js';
import simulateRouter from './routes/simulate.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('api');
const app = express();

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v1/signals', signalsRouter);
app.use('/api/v1/simulate', simulateRouter);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  try {
    // Initialize database
    await initDb();
    
    const port = config.api.port;
    app.listen(port, () => {
      logger.info({ port }, 'Flare API server started');
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down API server...');
      await closeDb();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start API server');
    process.exit(1);
  }
};

start();
