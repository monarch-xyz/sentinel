import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    console.log("Connected to database");

    const schemaPath = join(__dirname, "..", "src", "db", "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");

    console.log("Running migrations...");
    await client.query(schema);

    console.log("✅ Migrations complete");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
