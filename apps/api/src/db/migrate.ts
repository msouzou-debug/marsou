/**
 * Apply the SQL migrations in ./migrations, in file-name order, once each.
 *
 * ADR-0008: migrations are hand-written SQL, so the runner is deliberately
 * small — read the files, skip the ones already recorded, run the rest each in
 * its own transaction, record the id and the checksum. Re-running it is a
 * no-op, which is what the migration test asserts.
 *
 * It connects as MIGRATION_DATABASE_URL (the owner), not as the API role: the
 * API role must never be able to change the shape of the database.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { loadConfig } from "../config";

export const MIGRATIONS_DIR = join(__dirname, "migrations");

export interface MigrationFile {
  id: string;
  sql: string;
  checksum: string;
}

export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(dir, f), "utf8");
      return {
        id: f.replace(/\.sql$/, ""),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  lastMigrationId: string | null;
}

export async function runMigrations(databaseUrl: string): Promise<MigrateResult> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query("create schema if not exists ecapital");
    await client.query(`
      create table if not exists ecapital.schema_migration (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`);

    const { rows } = await client.query<{ id: string; checksum: string }>(
      "select id, checksum from ecapital.schema_migration",
    );
    const known = new Map(rows.map((r) => [r.id, r.checksum]));

    for (const migration of readMigrations()) {
      const seen = known.get(migration.id);
      if (seen) {
        if (seen !== migration.checksum) {
          throw new Error(
            `Migration ${migration.id} changed after it was applied. Write a new migration instead of editing this one.`,
          );
        }
        skipped.push(migration.id);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into ecapital.schema_migration (id, checksum) values ($1, $2)",
          [migration.id, migration.checksum],
        );
        await client.query("commit");
        applied.push(migration.id);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }

    const { rows: last } = await client.query<{ id: string }>(
      "select id from ecapital.schema_migration order by id desc limit 1",
    );
    return { applied, skipped, lastMigrationId: last[0]?.id ?? null };
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const config = loadConfig();
  runMigrations(config.migrationDatabaseUrl)
    .then((r) => {
      const what = r.applied.length ? `applied ${r.applied.join(", ")}` : "nothing to apply";
      console.log(`migrations: ${what} (at ${r.lastMigrationId ?? "none"})`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
