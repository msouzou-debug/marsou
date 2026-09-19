#!/usr/bin/env node
/**
 * eCapital — the bootstrap role CLI (ADR-0020, R01, R42).
 *
 *   pnpm --filter @ecapital/api grant-admin -- --username <sAMAccountName> [--name "…"] [--email …]
 *   pnpm --filter @ecapital/api grant-role  -- --username <sAMAccountName> --role auditor_readonly
 *   pnpm --filter @ecapital/api grant-role  -- --username <sAMAccountName> --role auditor_readonly --revoke
 *
 * Two jobs, and only two.
 *
 * **The first administrator.** A fresh ΟΚΥπΥ database has no administrator in
 * it, and Διαχείριση › Χρήστες is administrator-only, so there is no way in
 * through the application. `grant-admin` is the way in: it is run on the
 * server, over the migration connection, by somebody who already has a shell
 * there. From then on every other role is assigned in the screen.
 *
 * **The auditor.** CAPEX-01 §10 says the auditor "cannot be edited by admin".
 * `PATCH /admin/users/:id` refuses `auditor_readonly` in both directions with
 * `errors.auditorProtected`, so this CLI is the only way the role is granted
 * or taken away — an appointment made on the server, with a shell, not from
 * inside the system being audited.
 *
 * The account does not have to exist first. Where it does not, the row is
 * pre-registered exactly the way the screen pre-registers one: subject
 * `ad:<username>`, adopted by the objectGUID on the first Active Directory
 * bind, so the role is in force the first time the person signs in.
 *
 * RULE (R42): the work runs inside one transaction with `app.user_id` set to
 * `cli:<os user>`, so the audit triggers record who did it. There is no way
 * to run this without leaving that trail: the triggers are on the tables, not
 * on the route.
 *
 * Exit codes: 0 done, 1 the run could not start or the arguments were wrong.
 */
import { userInfo } from "node:os";
import { Client } from "pg";
import { AppRole, ROLE_SCOPE, type AppRole as AppRoleType } from "@ecapital/shared";
import { loadConfig } from "../config";

export interface GrantArgs {
  username: string | null;
  role: AppRoleType | null;
  name: string | null;
  email: string | null;
  revoke: boolean;
  help: boolean;
  /** Set when `--role` was given something that is not one of the eight. */
  unknownRole: string | null;
}

export function parseArgs(argv: string[], defaultRole: AppRoleType | null = null): GrantArgs {
  const args: GrantArgs = {
    username: null,
    role: defaultRole,
    name: null,
    email: null,
    revoke: false,
    help: false,
    unknownRole: null,
  };
  // `pnpm --filter … grant-role -- --username x` hands the script its own
  // `--` as the first argument. Drop it rather than making an operator care.
  const rest = argv.filter((a, i) => !(a === "--" && i === 0));
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    switch (flag) {
      case "--username":
        args.username = value ?? null;
        i += 1;
        break;
      case "--role": {
        const parsed = AppRole.safeParse(value);
        // RULE (ADR-0020): the eight roles and nothing else. A typo here
        // would otherwise reach Postgres as an enum cast error, which says
        // the same thing far less clearly.
        if (parsed.success) args.role = parsed.data;
        else args.unknownRole = value ?? "";
        i += 1;
        break;
      }
      case "--name":
        args.name = value ?? null;
        i += 1;
        break;
      case "--email":
        args.email = value ?? null;
        i += 1;
        break;
      case "--revoke":
        args.revoke = true;
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

export interface GrantResult {
  /** `created` where the account did not exist, `updated` where it did. */
  account: "created" | "found";
  userId: string;
  username: string;
  subject: string;
  role: AppRoleType;
  /** False where the person already held the role (or already did not). */
  changed: boolean;
  revoked: boolean;
  orgUnitIds: string[];
}

/**
 * Grant (or revoke) one role for one account, creating the account where it
 * does not exist yet. Exported so the tests can call it directly against a
 * database of their own rather than shelling out.
 */
export async function grantRole(options: {
  connectionString: string;
  username: string;
  role: AppRoleType;
  name?: string | null;
  email?: string | null;
  revoke?: boolean;
  /** Defaults to `cli:<os user>`, which is what the audit log records. */
  actor?: string;
  /** Used for the derived address of an account that carries none. */
  domain?: string;
}): Promise<GrantResult> {
  const username = options.username.trim();
  if (!username) throw new Error("--username is required");

  const actor = options.actor ?? `cli:${userInfo().username}`;
  const domain = options.domain ?? "ihcis.local";
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [actor]);

    const found = await client.query<{ id: string; subject: string }>(
      `select id, subject from ecapital.app_user
        where username is not null and lower(username) = lower($1)
        limit 1`,
      [username],
    );

    let userId: string;
    let subject: string;
    let account: GrantResult["account"];
    if (found.rows.length) {
      userId = found.rows[0].id;
      subject = found.rows[0].subject;
      account = "found";
      // An account that was switched off and is now being given a role back
      // is being brought back deliberately; leaving it off would make the
      // grant a lie.
      await client.query(
        "update ecapital.app_user set is_active = true, updated_at = now() where id = $1 and not is_active",
        [userId],
      );
    } else {
      subject = `ad:${username.toLowerCase()}`;
      const inserted = await client.query<{ id: string }>(
        `insert into ecapital.app_user (subject, username, name, email, auth_source, is_active)
              values ($1, $2, $3, $4, 'ldap', true)
           returning id`,
        [subject, username, options.name?.trim() || username, (options.email?.trim() || `${username}@${domain}`).toLowerCase()],
      );
      userId = inserted.rows[0].id;
      account = "created";
    }

    let changed: boolean;
    if (options.revoke) {
      const removed = await client.query(
        "delete from ecapital.app_user_role where app_user_id = $1 and role = $2",
        [userId, options.role],
      );
      changed = (removed.rowCount ?? 0) > 0;
    } else {
      const added = await client.query(
        `insert into ecapital.app_user_role (app_user_id, role)
              values ($1, $2)
         on conflict do nothing`,
        [userId, options.role],
      );
      changed = (added.rowCount ?? 0) > 0;
    }

    // RULE (ADR-0020): a role that reaches every unit carries every unit id,
    // because `finance` is the one such role the row policies do not let
    // through on the role alone. A unit-scoped role granted from here gets no
    // units — the CLI exists to bootstrap an administrator and to appoint the
    // auditor, both of which are all-unit roles, and guessing a hospital for
    // somebody would be worse than leaving the screen to do it.
    if (!options.revoke && ROLE_SCOPE[options.role] === "all") {
      await client.query(
        `insert into ecapital.app_user_org_unit (app_user_id, org_unit_id)
              select $1, id from ecapital.org_unit
         on conflict do nothing`,
        [userId],
      );
    }

    const units = await client.query<{ org_unit_id: string }>(
      "select org_unit_id from ecapital.app_user_org_unit where app_user_id = $1 order by org_unit_id",
      [userId],
    );

    await client.query("commit");
    return {
      account,
      userId,
      username,
      subject,
      role: options.role,
      changed,
      revoked: options.revoke === true,
      orgUnitIds: units.rows.map((u) => u.org_unit_id),
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export function usage(command: "grant-admin" | "grant-role"): string {
  if (command === "grant-admin") {
    return [
      "eCapital — give somebody the administrator role (ADR-0020).",
      "",
      "  pnpm --filter @ecapital/api grant-admin -- --username <sAMAccountName> [--name \"…\"] [--email …]",
      "",
      "Run on the server, as the migration role. The account is created if it",
      "does not exist yet and adopts its objectGUID on the first AD sign-in.",
    ].join("\n");
  }
  return [
    "eCapital — grant or revoke one role (ADR-0020).",
    "",
    "  pnpm --filter @ecapital/api grant-role -- --username <sAMAccountName> --role <role> [--revoke]",
    "",
    `Roles: ${Object.keys(ROLE_SCOPE).join(", ")}.`,
    "auditor_readonly is granted and revoked here and nowhere else (CAPEX-01 §10).",
  ].join("\n");
}

export function describe(result: GrantResult): string {
  const what = result.revoked ? "revoked" : "granted";
  const changed = result.changed ? what : `already ${result.revoked ? "did not hold" : "held"}`;
  const units = result.orgUnitIds.length ? `${result.orgUnitIds.length} unit(s)` : "no units";
  return [
    `account ${result.username}: ${result.account === "created" ? "created" : "found"} (subject ${result.subject})`,
    `role ${result.role}: ${changed}`,
    `units: ${units}`,
  ].join("\n");
}

/** The shared entry point of both scripts. */
export async function main(command: "grant-admin" | "grant-role", argv: string[]): Promise<number> {
  const args = parseArgs(argv, command === "grant-admin" ? "admin" : null);
  if (args.help) {
    console.log(usage(command));
    return 0;
  }
  if (args.unknownRole !== null) {
    console.error(
      `grant-role: "${args.unknownRole}" is not an eCapital role. One of: ${Object.keys(ROLE_SCOPE).join(", ")}.`,
    );
    return 1;
  }
  if (!args.username) {
    console.error(usage(command));
    return 1;
  }
  if (!args.role) {
    console.error("grant-role: --role is required.");
    return 1;
  }

  const config = loadConfig();
  const result = await grantRole({
    connectionString: config.migrationDatabaseUrl,
    username: args.username,
    role: args.role,
    name: args.name,
    email: args.email,
    revoke: args.revoke,
    domain: config.LDAP_DOMAIN ?? undefined,
  });
  console.log(describe(result));
  return 0;
}
