import { Client } from "pg";
import { config } from "../config/index.ts";
import { runMainMigrations } from "../db/migrator.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("db:migrate");

async function main() {
  const client = new Client({ connectionString: config.database.url });
  await client.connect();

  try {
    const result = await runMainMigrations(client);
    logger.info(result, "Database migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ error: message }, "Database migration failed");
  process.exit(1);
});
