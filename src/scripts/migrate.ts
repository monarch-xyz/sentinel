import { Client } from "pg";
import { config } from "../config/index.js";
import { findMainSchemaPath, loadMainSchemaSql } from "../db/schema-file.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("db:migrate");

async function main() {
  const schemaPath = await findMainSchemaPath();
  logger.info({ schemaPath }, "Running database migrations");

  const schemaSql = await loadMainSchemaSql();

  const client = new Client({ connectionString: config.database.url });
  await client.connect();

  try {
    await client.query(schemaSql);
    logger.info("Database migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ error: message }, "Database migration failed");
  process.exit(1);
});
