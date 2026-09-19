import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { TokenClaims, type AppRole } from "@ecapital/shared";
import { Client } from "pg";
import { CONFIG, type AppConfig } from "../config";
import { AppError } from "../common/errors";
import { DIRECTORY, type Directory, subjectFor } from "./directory";
import {
  type Verifier,
  createSessionVerifier,
  createOidcVerifier,
  signSessionToken,
} from "./tokens";

export interface SessionGrant {
  token: string;
  claims: TokenClaims;
  userId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly verifier: Verifier;
  private readonly directory: Directory | null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    // Built by AuthModule, and swapped for a fake by the tests; see ADR-0018
    // on why the seam is here and not inside `ldapts`. Null unless
    // AUTH_MODE=ldap.
    @Optional() @Inject(DIRECTORY) directory: Directory | null = null,
  ) {
    this.verifier =
      config.authMode === "oidc"
        ? createOidcVerifier(config)
        : createSessionVerifier(config.sessionSecret);

    this.directory = directory;

    if (config.authMode === "dev") {
      this.logger.warn("AUTH_MODE=dev: tokens are signed locally, not by a directory");
    }
    if (config.devAuthForcedInProduction) {
      // ADR-0018 §5. The boot was allowed to continue because somebody set
      // ALLOW_DEV_AUTH_IN_PRODUCTION; it should still be impossible to miss.
      this.logger.error(
        "DEV_AUTH IS ON IN PRODUCTION. Anybody who can reach this API can mint a token for any seeded account. Turn it off.",
      );
    }
    if (config.authMode === "ldap") {
      this.logger.log(`AUTH_MODE=ldap: binding against ${config.LDAP_URL ?? "(unset)"}`);
    }
  }

  async claimsFromBearer(header: string | undefined): Promise<TokenClaims> {
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw AppError.unauthorized();
    try {
      return await this.verifier.verify(token);
    } catch {
      // The reason a token failed is a gift to whoever is guessing at them.
      throw AppError.unauthorized();
    }
  }

  /**
   * ADR-0018 — sign in with a ΟΚΥπΥ Active Directory account.
   *
   * Bind as the person, write (or refresh) their `app_user` row and hand back
   * the same signed session token the development stub issues.
   *
   * RULE (ADR-0020): the roles on the token are the roles an administrator
   * assigned to this person in Διαχείριση › Χρήστες, unioned with whatever
   * `role_mapping` makes of their directory groups. The manual assignment is
   * the one that matters and a sign-in never deletes it; the group layer is
   * optional, empty on a fresh database, and still there for a deployment
   * that would rather drive roles from AD.
   *
   * RULE (ADR-0020): an account pre-registered by username adopts its
   * objectGUID on this first bind rather than being duplicated, so the roles
   * an administrator set before the person ever signed in survive the moment
   * they do.
   *
   * RULE (ADR-0020): a deactivated account is refused here, with the password
   * already proved correct — 401 `errors.accountDeactivated`.
   *
   * RULE: a bind failure is 401 `errors.notSignedIn` and nothing more. Not
   * "no such user", not "wrong password" — either would tell somebody
   * guessing which half of the guess was right.
   *
   * RULE (ADR-0009's safe direction): an account whose groups match no row in
   * `role_mapping` still gets a token, with no roles and no units. They sign
   * in and see nothing, which is the honest answer — the account exists, the
   * administrator has not given it anything yet — rather than a refusal that
   * looks like a broken password.
   */
  async login(username: string, password: string): Promise<SessionGrant> {
    if (this.config.authMode !== "ldap" || !this.directory) {
      throw AppError.notFound("errors.routeNotFound");
    }

    let user;
    try {
      user = await this.directory.authenticate(username, password);
    } catch (error) {
      // Unreachable server, TLS refused, a base DN that does not exist. The
      // message is safe to log — it carries no password, because nothing
      // below `authenticate` is ever given one to carry.
      this.logger.error(
        `directory is not answering: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw AppError.internal();
    }
    if (!user) throw AppError.unauthorized();

    const subject = subjectFor(user);
    const name = user.displayName?.trim() || user.uid;
    // TokenClaims wants an address. AD's `mail` is the right one; without it
    // the UPN is the next best thing and is an address in every ΟΚΥπΥ tenant.
    const email = (user.mail ?? `${user.uid}@${this.config.LDAP_DOMAIN ?? "invalid"}`).toLowerCase();

    const client = new Client({ connectionString: this.config.migrationDatabaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [subject]);

      const userId = await upsertUser(client, {
        subject,
        username: user.uid,
        name,
        email,
      });

      const mapped = await mappedAccess(client, user.memberOf);
      const assigned = await assignedAccess(client, userId);
      const roles = union(assigned.roles, mapped.roles) as AppRole[];
      const orgUnitIds = union(assigned.orgUnitIds, mapped.orgUnitIds);

      await client.query("commit");

      if (!roles.length) {
        this.logger.warn(
          `${user.uid} signed in with no role at all. An administrator assigns one in Διαχείριση › Χρήστες (ADR-0020).`,
        );
      }

      const claims = TokenClaims.parse({
        sub: subject,
        name,
        email,
        roles,
        org_unit_ids: orgUnitIds,
      });
      return { token: await signSessionToken(claims, this.config.sessionSecret), claims, userId };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }

  /**
   * Development only: mint a token for a seeded user, so somebody can open
   * the app without a directory at all.
   *
   * It reads the user over the migration connection, not the application
   * pool. There is no caller yet, so there is nothing to set app.user_id to,
   * and under the policy on app_user a session with no identity sees no
   * users — correctly. With `AUTH_MODE` anything but `dev` this route does
   * not exist at all.
   */
  async devTokenFor(email: string): Promise<SessionGrant> {
    if (this.config.authMode !== "dev") throw AppError.notFound("errors.routeNotFound");

    const client = new Client({ connectionString: this.config.migrationDatabaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{
        id: string;
        subject: string;
        name: string;
        is_active: boolean;
      }>(
        "select id, subject, name, is_active from ecapital.app_user where email = $1 limit 1",
        [email],
      );
      const user = rows[0];
      if (!user) throw AppError.notFound("errors.userNotFound", { email });
      // RULE (ADR-0020): a deactivated account is refused at the door, in
      // every mode. Not 404 — the account exists and an administrator turned
      // it off, which is a different fact and a more useful one.
      if (!user.is_active) throw AppError.unauthorized("errors.accountDeactivated");

      const roles = await client.query<{ role: string }>(
        "select role from ecapital.app_user_role where app_user_id = $1 order by role",
        [user.id],
      );
      const units = await client.query<{ org_unit_id: string }>(
        "select org_unit_id from ecapital.app_user_org_unit where app_user_id = $1 order by org_unit_id",
        [user.id],
      );

      // ADR-0020: the stub is a sign-in like any other, so it stamps the
      // same column the directory bind does.
      await client.query(
        "update ecapital.app_user set last_sign_in_at = now() where id = $1",
        [user.id],
      );

      const claims = TokenClaims.parse({
        sub: user.subject,
        name: user.name,
        email,
        roles: roles.rows.map((r) => r.role),
        org_unit_ids: units.rows.map((u) => u.org_unit_id),
      });
      return { token: await signSessionToken(claims, this.config.sessionSecret), claims, userId: user.id };
    } finally {
      await client.end();
    }
  }
}

/**
 * Groups → roles and units, through `ecapital.role_mapping` (ADR-0009,
 * ADR-0018). The comparison is case-insensitive because a distinguished name
 * is: Active Directory will hand back `CN=eCapital Admins,OU=Groups,DC=ihcis,
 * DC=local` today and the same name in different case after somebody edits
 * the group in the console, and an administrator should not have to know
 * that.
 *
 * A mapping row with no `org_unit_id` means every unit (ADR-0009). Three
 * roles — admin, executive_readonly, auditor_readonly — see every unit
 * through the role anyway, so for them the list is belt and braces; for
 * `finance`, which the owner's decision of 19/09/2026 put across the whole
 * organisation, the list is what does the work.
 *
 * ADR-0020 keeps this as an optional layer on top of the per-user
 * assignment, not as the way roles arrive. On a fresh ΟΚΥπΥ database there
 * are no rows here at all and this returns nothing, which is correct.
 */
async function mappedAccess(
  client: Client,
  memberOf: string[],
): Promise<{ roles: AppRole[]; orgUnitIds: string[] }> {
  if (!memberOf.length) return { roles: [], orgUnitIds: [] };

  const { rows } = await client.query<{ role: AppRole; org_unit_id: string | null }>(
    `select role, org_unit_id
       from ecapital.role_mapping
      where lower(group_id) = any ($1::text[])`,
    [memberOf.map((dn) => dn.trim().toLowerCase())],
  );
  if (!rows.length) return { roles: [], orgUnitIds: [] };

  const roles = [...new Set(rows.map((r) => r.role))].sort();
  const units = new Set(rows.map((r) => r.org_unit_id).filter((u): u is string => u !== null));
  if (rows.some((r) => r.org_unit_id === null)) {
    const all = await client.query<{ id: string }>("select id from ecapital.org_unit");
    for (const row of all.rows) units.add(row.id);
  }
  return { roles, orgUnitIds: [...units].sort() };
}

/**
 * What an administrator assigned to this person in Διαχείριση › Χρήστες
 * (ADR-0020) — the manual half of the union, and the half that normally
 * carries everything.
 */
async function assignedAccess(
  client: Client,
  userId: string,
): Promise<{ roles: AppRole[]; orgUnitIds: string[] }> {
  const roles = await client.query<{ role: AppRole }>(
    "select role from ecapital.app_user_role where app_user_id = $1",
    [userId],
  );
  const units = await client.query<{ org_unit_id: string }>(
    "select org_unit_id from ecapital.app_user_org_unit where app_user_id = $1",
    [userId],
  );
  return {
    roles: roles.rows.map((r) => r.role),
    orgUnitIds: units.rows.map((u) => u.org_unit_id),
  };
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

/**
 * Create the row on the first sign-in, refresh it afterwards — and adopt a
 * pre-registered one rather than making a second (ADR-0020).
 *
 * RULE (ADR-0020): an administrator can pre-register an AD account before it
 * has ever signed in. That row has no objectGUID to key on, so it carries
 * `subject = 'ad:<username>'` and the account name in `username`. The first
 * real bind looks for the objectGUID, does not find it, finds the row by
 * account name instead and moves the subject onto the GUID. The roles the
 * administrator set therefore survive the first sign-in, which is the whole
 * point of pre-registering.
 *
 * RULE (ADR-0020): roles and units are NOT touched here. A sign-in refreshes
 * who somebody is — their name, their address, when they last arrived — and
 * never what they may do. That is an administrator's to set and a login's to
 * read.
 *
 * RULE (ADR-0020): a deactivated account is refused, with 401
 * `errors.accountDeactivated`, and is not quietly reactivated by signing in.
 */
async function upsertUser(
  client: Client,
  user: { subject: string; username: string; name: string; email: string },
): Promise<string> {
  const existing = await client.query<{ id: string; is_active: boolean }>(
    `select id, is_active
       from ecapital.app_user
      where subject = $1
         or (username is not null and lower(username) = lower($2))
      order by (subject = $1) desc
      limit 1`,
    [user.subject, user.username],
  );

  if (!existing.rows.length) {
    const inserted = await client.query<{ id: string }>(
      `insert into ecapital.app_user (subject, username, name, email, auth_source, is_active, last_sign_in_at)
            values ($1, $2, $3, $4, 'ldap', true, now())
         returning id`,
      [user.subject, user.username, user.name, user.email],
    );
    return inserted.rows[0].id;
  }

  const row = existing.rows[0];
  if (!row.is_active) throw AppError.unauthorized("errors.accountDeactivated");

  // The address is refreshed only when nobody else holds it. `app_user.email`
  // is unique and a directory can hand back an address a seeded row already
  // has; losing the sign-in over that would be absurd, and the old address is
  // still a working one.
  await client.query(
    `update ecapital.app_user
        set subject = $2,
            username = $3,
            name = $4,
            email = case
                      when exists (select 1 from ecapital.app_user other
                                    where other.email = $5 and other.id <> app_user.id)
                      then email else $5 end,
            auth_source = 'ldap',
            last_sign_in_at = now(),
            updated_at = now()
      where id = $1`,
    [row.id, user.subject, user.username, user.name, user.email],
  );
  return row.id;
}
