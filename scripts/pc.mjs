#!/usr/bin/env node
// eCapital on a PC, for trying the screens without the ΟΚΥπΥ server.
//
//   pnpm pc:setup   once: a private PostgreSQL 16 under .tmp/pc-db, the two
//                   env files, migrations, the twelve seeded accounts and
//                   the sample register.
//   pnpm pc:start   every time: database, API (3001) and web (3000), then
//                   the browser on http://localhost:3000. Ctrl+C stops all.
//   pnpm pc:stop    stops a database left running.
//
// Nothing here touches the ΟΚΥπΥ server, Active Directory, eFinance or
// eArchive. Sign-in is the dev mode (ADR-0009): pick one of the seeded
// accounts on the sign-in screen. That mode is refused in production by
// config.ts, which is why this script never writes NODE_ENV=production.
//
// PostgreSQL comes from the `embedded-postgres` npm package, pinned to the
// same 16.14 the server runs, so no installer and no admin rights on the PC.
// Node 22 and pnpm are the only prerequisites (docs/pc-test.md).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { default: EmbeddedPostgres } = await import("embedded-postgres");
const { Client } = require("pg");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, ".tmp", "pc-db");
const PORT = Number(process.env.ECAPITAL_PC_DB_PORT ?? 5433);
const API_PORT = 3001;
const WEB_PORT = 3000;
const SUPER = { user: "postgres", password: "ecapital-pc" };
const APP_PASSWORD = "ecapital-pc-app";
const API_ENV = join(ROOT, "apps", "api", ".env");
const WEB_ENV = join(ROOT, "apps", "web", ".env.local");
const IS_WIN = process.platform === "win32";

const step = (s) => console.log(`\n=== ${s} ===`);

// The one cluster object of this run. embedded-postgres stops only a
// process it started itself, and stops it again when Node exits, so the
// database lives exactly as long as this script.
let server;

function pg() {
  server ??= new EmbeddedPostgres({
    databaseDir: DB_DIR,
    user: SUPER.user,
    password: SUPER.password,
    port: PORT,
    persistent: true,
    // PostgreSQL refuses to run as root. A PC login is never root; this only
    // matters on a Linux box where the script is run with sudo or in a container.
    createPostgresUser: typeof process.getuid === "function" && process.getuid() === 0,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "timezone=UTC"],
    onLog: () => {},
  });
  return server;
}

async function stopDb() {
  if (server) await server.stop();
}

async function canConnect(database = "postgres", user = SUPER.user, password = SUPER.password) {
  const c = new Client({ host: "127.0.0.1", port: PORT, user, password, database, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

async function query(sql, database = "postgres") {
  const c = new Client({ host: "127.0.0.1", port: PORT, user: SUPER.user, password: SUPER.password, database });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

async function ensureRunning() {
  if (await canConnect()) {
    console.error(`Something already answers on 127.0.0.1:${PORT}. Run: pnpm pc:stop  (or set ECAPITAL_PC_DB_PORT)`);
    process.exit(1);
  }
  const db = pg();
  if (!existsSync(join(DB_DIR, "PG_VERSION"))) {
    mkdirSync(DB_DIR, { recursive: true });
    await db.initialise();
    console.log(`database cluster created under ${DB_DIR}`);
  }
  await db.start();
  console.log(`PostgreSQL 16 listening on 127.0.0.1:${PORT}`);
}

/** KEY=value lines of an env file. Comments, blanks and empty values (KEY=) are skipped: config.ts treats «unset» and «empty» differently, and the template leaves optional keys empty. */
function readEnv(path) {
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const value = line.slice(i + 1).trim();
    if (value) out[line.slice(0, i).trim()] = value;
  }
  return out;
}

function writeApiEnv() {
  const example = readFileSync(join(ROOT, "apps", "api", ".env.example"), "utf8");
  const set = (text, key, value) => {
    const re = new RegExp(`^${key}=.*$`, "m");
    return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text}\n${key}=${value}\n`;
  };
  let text = example;
  text = set(text, "DATABASE_URL", `postgres://ecapital_app:${APP_PASSWORD}@127.0.0.1:${PORT}/ecapital`);
  text = set(text, "MIGRATION_DATABASE_URL", `postgres://${SUPER.user}:${SUPER.password}@127.0.0.1:${PORT}/ecapital`);
  text = set(text, "PORT", String(API_PORT));
  text = set(text, "DOCUMENT_STORE_DIR", join(ROOT, ".tmp", "pc-documents"));
  mkdirSync(join(ROOT, ".tmp", "pc-documents"), { recursive: true });
  writeFileSync(API_ENV, text);
  console.log(`wrote ${API_ENV}`);
}

function writeWebEnv() {
  const example = readFileSync(join(ROOT, "apps", "web", ".env.example"), "utf8");
  writeFileSync(WEB_ENV, example);
  console.log(`wrote ${WEB_ENV}`);
}

function run(cmd, args, env, opts = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", shell: IS_WIN, env: { ...process.env, ...env }, ...opts });
    child.on("exit", (code) => (code === 0 ? resolveRun() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
    child.on("error", reject);
  });
}

async function setup() {
  step("[1/5] PostgreSQL 16 under .tmp/pc-db");
  await ensureRunning();
  const db = await query("select 1 from pg_database where datname = 'ecapital'");
  if (db.rowCount === 0) {
    await query("create database ecapital");
    console.log("database ecapital created");
  } else {
    console.log("database ecapital exists");
  }
  // The migration creates ecapital_app `if not exists`, without a password.
  // Create it here with one, so the API can log in as it and row-level
  // security applies exactly as on the server (a superuser would bypass it).
  const role = await query("select 1 from pg_roles where rolname = 'ecapital_app'");
  await query(
    role.rowCount === 0
      ? `create role ecapital_app login password '${APP_PASSWORD}'`
      : `alter role ecapital_app with login password '${APP_PASSWORD}'`,
  );
  await query("create extension if not exists pgcrypto", "ecapital");
  await query("create extension if not exists pg_trgm", "ecapital");

  step("[2/5] Env files");
  writeApiEnv();
  writeWebEnv();
  const env = readEnv(API_ENV);

  step("[3/5] Migrations");
  await run("pnpm", ["--filter", "@ecapital/api", "migrate"], env);

  step("[4/5] Seed: twelve units, sample projects, contracts, permits, assets, the dev accounts");
  await run("pnpm", ["--filter", "@ecapital/api", "seed"], env);

  await stopDb();
  step("[5/5] Done");
  console.log(`Next: pnpm pc:start  (then http://localhost:${WEB_PORT})`);
}

function openBrowser(url) {
  const [cmd, args] = IS_WIN
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function waitFor(url, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status > 0 && r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function start() {
  if (!existsSync(API_ENV) || !existsSync(join(DB_DIR, "PG_VERSION"))) {
    console.error("Not set up yet. Run: pnpm pc:setup");
    process.exit(1);
  }
  step("[1/3] PostgreSQL");
  await ensureRunning();
  const env = readEnv(API_ENV);
  if (!(await canConnect("ecapital", "ecapital_app", APP_PASSWORD))) {
    console.error("The API role cannot log in. Run: pnpm pc:setup");
    process.exit(1);
  }

  step("[2/3] API on :3001 and web on :3000");
  const children = [];
  const launch = (label, args, extraEnv) => {
    // pnpm → sh → node → next-server is four processes deep. Each child gets
    // its own process group (Linux, macOS) so one signal to the group, or
    // taskkill /t on Windows, takes the whole tree down with it.
    const child = spawn("pnpm", args, {
      cwd: ROOT,
      shell: IS_WIN,
      detached: !IS_WIN,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tag = (line) => `[${label}] ${line}`;
    child.stdout.on("data", (d) => process.stdout.write(d.toString().split("\n").filter(Boolean).map(tag).join("\n") + "\n"));
    child.stderr.on("data", (d) => process.stderr.write(d.toString().split("\n").filter(Boolean).map(tag).join("\n") + "\n"));
    child.on("exit", (code) => {
      if (!stopping) {
        console.error(`[${label}] exited with ${code}; stopping the rest`);
        shutdown();
      }
    });
    children.push(child);
  };
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    for (const c of children) {
      try {
        if (IS_WIN) spawn("taskkill", ["/pid", String(c.pid), "/t", "/f"], { stdio: "ignore" });
        else process.kill(-c.pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await stopDb();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  launch("api", ["--filter", "@ecapital/api", "dev"], env);
  launch("web", ["--filter", "@ecapital/web", "dev"], {});

  step("[3/3] Waiting for the sign-in page");
  const ok = await waitFor(`http://localhost:${WEB_PORT}/sign-in`);
  if (ok) {
    console.log(`\neCapital is up: http://localhost:${WEB_PORT}  (Ctrl+C here stops everything)`);
    if (!process.env.ECAPITAL_PC_NO_BROWSER) openBrowser(`http://localhost:${WEB_PORT}`);
  } else {
    console.error("The web app did not answer within two minutes. Read the [api] and [web] lines above.");
  }
}

/** For a cluster left behind by a run that was killed rather than stopped. */
async function stop() {
  if (!existsSync(join(DB_DIR, "postmaster.pid"))) {
    console.log("PostgreSQL is not running.");
    return;
  }
  // The platform package is a dependency of embedded-postgres, not of this repo, so resolve it from there.
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const fromEmbedded = createRequire(require.resolve("embedded-postgres"));
  const { pg_ctl } = await import(fromEmbedded.resolve(`@embedded-postgres/${platform}-${process.arch}`));
  await run(pg_ctl, ["stop", "-D", DB_DIR, "-m", "fast"], {}, { shell: false });
  console.log("PostgreSQL stopped.");
}

const cmd = process.argv[2];
try {
  if (cmd === "setup") await setup();
  else if (cmd === "start") await start();
  else if (cmd === "stop") await stop();
  else {
    console.error("usage: node scripts/pc.mjs setup | start | stop");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
