import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findMainSchemaPath(): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.DB_SCHEMA_PATH,
    path.resolve(process.cwd(), "schema.sql"),
    path.resolve(process.cwd(), "dist/db/schema.sql"),
    path.resolve(process.cwd(), "src/db/schema.sql"),
    path.resolve(currentDir, "schema.sql"),
    path.resolve(currentDir, "../../schema.sql"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error(`Schema file not found. Tried: ${candidates.map((c) => `"${c}"`).join(", ")}`);
}

export async function loadMainSchemaSql(): Promise<string> {
  const schemaPath = await findMainSchemaPath();
  const schemaSql = await readFile(schemaPath, "utf8");

  if (!schemaSql.trim()) {
    throw new Error(`Schema file is empty: ${schemaPath}`);
  }

  return schemaSql;
}
