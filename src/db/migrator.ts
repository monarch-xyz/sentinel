import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientBase } from "pg";

const MIGRATIONS_TABLE = "schema_migrations";

export interface MigrationResult {
  migrationsPath: string;
  total: number;
  applied: number;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findMainMigrationsPath(): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "migrations"),
    path.resolve(process.cwd(), "dist/db/migrations"),
    path.resolve(process.cwd(), "src/db/migrations"),
    path.resolve(currentDir, "migrations"),
    path.resolve(currentDir, "../../migrations"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error(`Migration directory not found. Tried: ${candidates.join(", ")}`);
}

async function ensureMigrationsTable(client: ClientBase): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listMigrationFiles(migrationsPath: string): Promise<string[]> {
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function loadAppliedMigrations(client: ClientBase): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id ASC`,
  );
  return new Set(rows.map((row) => row.id));
}

export async function runMainMigrations(client: ClientBase): Promise<MigrationResult> {
  const migrationsPath = await findMainMigrationsPath();
  const files = await listMigrationFiles(migrationsPath);

  await ensureMigrationsTable(client);
  const appliedMigrations = await loadAppliedMigrations(client);

  let applied = 0;

  for (const fileName of files) {
    if (appliedMigrations.has(fileName)) continue;

    const migrationPath = path.join(migrationsPath, fileName);
    const sql = await readFile(migrationPath, "utf8");
    if (!sql.trim()) continue;

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES ($1)`, [fileName]);
      await client.query("COMMIT");
      applied += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply migration ${fileName}: ${message}`);
    }
  }

  return {
    migrationsPath,
    total: files.length,
    applied,
  };
}
