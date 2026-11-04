import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

/**
 * Minimal versioned migration runner.
 * Files live in api/migrations as NNN_name.up.sql / NNN_name.down.sql.
 * Each step runs in its own transaction and is recorded in schema_migrations.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
// api/src/migrator.ts (dev) → api/migrations; api/dist/src/migrator.js (built) → api/migrations
export const MIGRATIONS_DIR =
  [path.resolve(here, "..", "migrations"), path.resolve(here, "..", "..", "migrations")].find((d) => existsSync(d)) ??
  path.resolve(here, "..", "migrations");
const MIGRATION_LOCK = 436_0001; // session advisory lock: only one process migrates at a time

export interface Migration {
  version: string; // e.g. "001_core_schema"
  upFile: string;
  downFile: string;
}

export async function listMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = await readdir(dir);
  const versions = files
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.replace(/\.up\.sql$/, ""))
    .sort();
  return versions.map((version) => {
    const downFile = path.join(dir, `${version}.down.sql`);
    if (!files.includes(`${version}.down.sql`)) {
      throw new Error(`Migration ${version} has no down file; every migration must be reversible`);
    }
    return { version, upFile: path.join(dir, `${version}.up.sql`), downFile };
  });
}

async function ensureTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function appliedVersions(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    return rows.map((r) => r.version);
  } finally {
    client.release();
  }
}

export async function migrateUp(pool: pg.Pool, log: (m: string) => void = () => {}): Promise<string[]> {
  const all = await listMigrations();
  const lock = await pool.connect();
  try {
    // Two instances starting together (or a deploy overlapping the old one) can't both migrate.
    await lock.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    return await applyPending(pool, all, log);
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    lock.release();
  }
}

async function applyPending(pool: pg.Pool, all: Migration[], log: (m: string) => void): Promise<string[]> {
  const done = new Set(await appliedVersions(pool));
  const applied: string[] = [];
  for (const m of all) {
    if (done.has(m.version)) continue;
    const sql = await readFile(m.upFile, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
      await client.query("COMMIT");
      applied.push(m.version);
      log(`up   ${m.version}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${m.version} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

/** Roll back the most recent `steps` migrations (default 1). */
export async function migrateDown(
  pool: pg.Pool,
  steps = 1,
  log: (m: string) => void = () => {},
): Promise<string[]> {
  const all = await listMigrations();
  const byVersion = new Map(all.map((m) => [m.version, m]));
  const done = (await appliedVersions(pool)).reverse().slice(0, steps);
  const reverted: string[] = [];
  for (const version of done) {
    const m = byVersion.get(version);
    if (!m) throw new Error(`No files for applied migration ${version}`);
    const sql = await readFile(m.downFile, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("DELETE FROM schema_migrations WHERE version = $1", [version]);
      await client.query("COMMIT");
      reverted.push(version);
      log(`down ${version}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Rollback of ${version} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return reverted;
}
