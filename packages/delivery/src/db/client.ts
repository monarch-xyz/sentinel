import pg from "pg";
import { env } from "../utils/env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await pool.end();
});

export type DbClient = pg.Pool | pg.PoolClient;
