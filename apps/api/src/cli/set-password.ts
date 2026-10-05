#!/usr/bin/env node
/**
 * eCapital — set a local account's password from the server (ADR-0030).
 *
 *   pnpm --filter @ecapital/api set-password -- --username <name> [--create-admin]
 *
 * Asks for the password twice, with the terminal echo off, and never prints
 * it. `--create-admin` makes the account first, with the administrator role,
 * the way `grant-admin` does — which is how the very first local account
 * exists on a server that has no reachable directory yet. Everything after
 * that happens in Διαχείριση › Χρήστες.
 *
 * RULE (R42): the write runs inside one transaction with `app.user_id` set
 * to `cli:<os user>`, so the audit row records who set it. The row records
 * that a password was set, not the password (migration 0021).
 *
 * Exit codes: 0 done, 1 the run could not start, the arguments were wrong,
 * or the account does not exist and --create-admin was not given.
 */
import { userInfo } from "node:os";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { Client } from "pg";
import { PASSWORD_MIN_LENGTH } from "@ecapital/shared";
import { loadConfig } from "../config";
import { hashPassword } from "../auth/password";
import { grantRole } from "./grant-role";

export interface SetPasswordArgs {
  username: string | null;
  createAdmin: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): SetPasswordArgs {
  const args: SetPasswordArgs = { username: null, createAdmin: false, help: false };
  const rest = argv.filter((a, i) => !(a === "--" && i === 0));
  for (let i = 0; i < rest.length; i += 1) {
    switch (rest[i]) {
      case "--username":
        args.username = rest[i + 1] ?? null;
        i += 1;
        break;
      case "--create-admin":
        args.createAdmin = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

/**
 * Store the hash for an account, by username or address. Exported for the
 * tests; the server runs it through `main`.
 */
export async function setPassword(options: {
  connectionString: string;
  username: string;
  password: string;
  actor?: string;
}): Promise<{ userId: string; username: string }> {
  const typed = options.username.trim();
  if (!typed) throw new Error("--username is required");
  if (options.password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`the password needs at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const actor = options.actor ?? `cli:${userInfo().username}`;
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [actor]);
    const found = await client.query<{ id: string; username: string | null; email: string }>(
      `select id, username, email from ecapital.app_user
        where lower(username) = lower($1) or lower(email) = lower($1)
        order by (lower(username) = lower($1)) desc
        limit 1`,
      [typed],
    );
    if (!found.rows.length) {
      throw new Error(
        `no account is called ${typed}. Add it in Διαχείριση › Χρήστες first, or pass --create-admin for the first administrator.`,
      );
    }
    const row = found.rows[0];
    await client.query(
      `insert into ecapital.app_user_password (app_user_id, password_hash)
            values ($1, $2)
       on conflict (app_user_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
      [row.id, hashPassword(options.password)],
    );
    await client.query("commit");
    return { userId: row.id, username: row.username ?? row.email };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** One line read from the terminal with echo off. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const muted = new Writable({ write: (_chunk, _enc, done) => done() });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stderr.write(prompt);
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

export function usage(): string {
  return [
    "eCapital — set the eCapital password of an account (ADR-0030, AUTH_MODE=local).",
    "",
    "  pnpm --filter @ecapital/api set-password -- --username <name> [--create-admin]",
    "",
    "Asks for the password twice and never prints it. --create-admin makes the",
    "account with the administrator role when it does not exist yet.",
  ].join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (!args.username) {
    console.error(usage());
    return 1;
  }
  const config = loadConfig();
  if (config.authMode !== "local") {
    console.error(
      `AUTH_MODE is ${config.authMode}, not local. The password would be stored and nobody could sign in with it. Set AUTH_MODE=local in api.env first (ADR-0030).`,
    );
    return 1;
  }

  if (args.createAdmin) {
    const result = await grantRole({
      connectionString: config.migrationDatabaseUrl,
      username: args.username,
      role: "admin",
      domain: config.LDAP_DOMAIN ?? undefined,
    });
    console.log(`account ${result.username}: ${result.account} (subject ${result.subject}); role admin: ${result.changed ? "granted" : "already held"}`);
  }

  const first = await askHidden(`Password for ${args.username}: `);
  const second = await askHidden("Again: ");
  if (first !== second) {
    console.error("The two entries differ. Nothing was changed.");
    return 1;
  }
  const done = await setPassword({
    connectionString: config.migrationDatabaseUrl,
    username: args.username,
    password: first,
  });
  console.log(`password set for ${done.username}. Sign in at the eCapital sign-in page with that name.`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
