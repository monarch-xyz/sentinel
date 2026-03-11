import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSchemaPath(): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.DB_SCHEMA_PATH,
    path.resolve(process.cwd(), "schema.sql"),
    path.resolve(process.cwd(), "dist/db/schema.sql"),
    path.resolve(process.cwd(), "src/db/schema.sql"),
    path.resolve(currentDir, "../db/schema.sql"),
    path.resolve(currentDir, "../../src/db/schema.sql"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error(`Schema file not found. Tried: ${candidates.map((c) => `"${c}"`).join(", ")}`);
}

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const schemaPath = await findSchemaPath();
  const schema = await readFile(schemaPath, "utf-8");
  if (!schema.trim()) {
    throw new Error("Schema file is empty");
  }

  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    console.log(`Running delivery migrations from ${schemaPath}`);
    await client.query(schema);
    console.log("✅ Delivery migrations complete");
  } finally {
    await client.end();
  }
}

migrate().catch((error) => {
  console.error("Delivery migration failed:", error);
  process.exit(1);
});
