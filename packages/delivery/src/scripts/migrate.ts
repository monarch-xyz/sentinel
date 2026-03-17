import pg from "pg";
import { runDeliveryMigrations } from "../db/migrator.js";
import "dotenv/config";

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    const result = await runDeliveryMigrations(client);
    console.log(
      `✅ Delivery migrations complete (${result.applied}/${result.total} applied)`,
    );
  } finally {
    await client.end();
  }
}

migrate().catch((error) => {
  console.error("Delivery migration failed:", error);
  process.exit(1);
});
