import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SQL } from "bun";
import { env } from "./env";

// Single Postgres client for the API. Bun.SQL is built into Bun 1.1.30+; no
// driver dep required. DATABASE_URL is read from .env via env.ts.
export const sql = new SQL(env.DATABASE_URL);

// Run schema.sql at startup. Each statement is idempotent (CREATE TABLE IF NOT
// EXISTS / CREATE INDEX IF NOT EXISTS) so this is safe on every boot.
export async function bootstrapSchema(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(here, "schema.sql");
  const ddl = await readFile(schemaPath, "utf8");

  console.log(`[db] running schema bootstrap from ${schemaPath}`);
  // Bun.SQL's `unsafe` runs raw SQL without parameterization — required for
  // multi-statement DDL files. Safe here because the input is a checked-in file.
  await sql.unsafe(ddl);
  console.log(`[db] schema bootstrap complete`);
}
