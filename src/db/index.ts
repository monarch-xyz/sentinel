import pg from 'pg';
import { config } from '../config/index.js';
import { schema } from './schema.js';
import pino from 'pino';

const logger = pino();
const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.url,
});

export async function initDb() {
  try {
    await pool.query(schema);
    logger.info('Database initialized successfully');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Database initialization failed');
    throw error;
  }
}

export class SignalRepository {
  async create(signal: any) {
    const query = `
      INSERT INTO signals (name, description, definition, webhook_url, cooldown_minutes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [
      signal.name,
      signal.description,
      JSON.stringify(signal.definition),
      signal.webhook_url,
      signal.cooldown_minutes,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  async list(activeOnly = false) {
    const query = activeOnly 
      ? 'SELECT * FROM signals WHERE is_active = true ORDER BY created_at DESC'
      : 'SELECT * FROM signals ORDER BY created_at DESC';
    const { rows } = await pool.query(query);
    return rows;
  }

  async getById(id: string) {
    const { rows } = await pool.query('SELECT * FROM signals WHERE id = $1', [id]);
    return rows[0];
  }

  async update(id: string, updates: any) {
    const fields = Object.keys(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map(f => f === 'definition' ? JSON.stringify(updates[f]) : updates[f]);
    
    const query = `
      UPDATE signals 
      SET ${setClause}, updated_at = NOW() 
      WHERE id = $1 
      RETURNING *
    `;
    const { rows } = await pool.query(query, [id, ...values]);
    return rows[0];
  }

  async delete(id: string) {
    await pool.query('DELETE FROM signals WHERE id = $1', [id]);
    return { deleted: true, id };
  }
}
