import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate";
import { seed } from "../src/db/seed";

/**
 * ADR-0012. One throwaway PostgreSQL 16 cluster for the whole run: initdb into
 * a temp directory, migrate, seed, run the suites, stop it, delete it. There
 * is no Docker daemon in this environment and the tests need a real Postgres,
 * because row-level security and the audit trigger are the thing under test —
 * a fake would prove nothing.
 */
const SCRIPT = join(__dirname, "..", "scripts", "test-db.sh");

function run(command: "start" | "stop"): string {
  return execFileSync(SCRIPT, [command], { encoding: "utf8" });
}

export async function setup(): Promise<void> {
  const output = run("start");
  for (const line of output.split("\n")) {
    const [key, value] = line.split("=");
    if (key && value) process.env[key.trim()] = value.trim();
  }

  process.env.NODE_ENV = "test";
  process.env.DEV_AUTH = "1";
  process.env.DEV_AUTH_SECRET = "ecapital-test-secret-0123456789";
  process.env.LOG_LEVEL = "silent";
  process.env.ECAPITAL_TEST_ADMIN_URL =
    `postgres://postgres@127.0.0.1:${process.env.PGPORT}/postgres`;

  await runMigrations(process.env.MIGRATION_DATABASE_URL as string);
  await seed(process.env.MIGRATION_DATABASE_URL as string);
}

export async function teardown(): Promise<void> {
  run("stop");
}
