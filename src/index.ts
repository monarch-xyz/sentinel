import express from 'express';
import { config } from '../config/index.js';
import signalRoutes from './api/routes/signals.js';
import { initDb } from './db/index.js';
import pino from 'pino';

const logger = pino();
const app = express();

app.use(express.json());

// API Routes
app.use('/api/v1/signals', signalRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', version: '0.1.0' });
});

// Initialize and Start
const start = async () => {
  try {
    // Only init DB if not in test
    if (process.env.NODE_ENV !== 'test') {
      await initDb();
    }
    
    app.listen(config.api.port, config.api.host, () => {
      logger.info(`Flare API running on http://${config.api.host}:${config.api.port}`);
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start server');
    process.exit(1);
  }
};

start();
