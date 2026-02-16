import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { config } from "../config/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("db:migrate");

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSchemaPath(): Promise<string> {
  const candidates = [
    process.env.DB_SCHEMA_PATH,
    path.resolve(process.cwd(), "schema.sql"),
    path.resolve(process.cwd(), "dist/db/schema.sql"),
    path.resolve(process.cwd(), "src/db/schema.sql"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/schema.sql"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error(`Schema file not found. Tried: ${candidates.map((c) => `"${c}"`).join(", ")}`);
}

async function main() {
  const schemaPath = await findSchemaPath();
  logger.info({ schemaPath }, "Running database migrations");

  const schemaSql = await readFile(schemaPath, "utf8");
  if (!schemaSql.trim()) {
    throw new Error("Schema file is empty");
  }

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
