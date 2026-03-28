import pg from "pg";
import { env } from "../utils/env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let closePromise: Promise<void> | null = null;

export async function closePool(): Promise<void> {
  if (!closePromise) {
    closePromise = pool.end().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Called end on pool more than once")) {
        return;
      }

      closePromise = null;
      throw error;
    });
  }

  await closePromise;
}

export type DbClient = pg.Pool | pg.PoolClient;
