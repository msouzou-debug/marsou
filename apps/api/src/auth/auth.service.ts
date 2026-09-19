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
   * Bind as the person, read their groups, turn those groups into roles and
   * units through `role_mapping`, write (or refresh) their `app_user` row and
   * hand back the same signed session token the development stub issues.
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

      const { roles, orgUnitIds } = await mappedAccess(client, user.memberOf);
      const userId = await upsertUser(client, { subject, name, email, roles, orgUnitIds });

      await client.query("commit");

      if (!roles.length) {
        this.logger.warn(
          `${user.uid} signed in with no mapped group: groups=${user.memberOf.length}. Add a role_mapping row for their AD group.`,
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
      const { rows } = await client.query<{ id: string; subject: string; name: string }>(
        "select id, subject, name from ecapital.app_user where email = $1 and is_active limit 1",
        [email],
      );
      const user = rows[0];
      if (!user) throw AppError.notFound("errors.userNotFound", { email });

      const roles = await client.query<{ role: string }>(
        "select role from ecapital.app_user_role where app_user_id = $1 order by role",
        [user.id],
      );
      const units = await client.query<{ org_unit_id: string }>(
        "select org_unit_id from ecapital.app_user_org_unit where app_user_id = $1 order by org_unit_id",
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
 * Create the row on first sign-in, refresh it afterwards. The display name,
 * the address, the roles and the units all come from the directory every
 * time: somebody moved from Λάρνακα to Λεμεσό last week should see Λεμεσό
 * today, without an administrator touching eCapital.
 */
async function upsertUser(
  client: Client,
  user: { subject: string; name: string; email: string; roles: AppRole[]; orgUnitIds: string[] },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ecapital.app_user (subject, name, email, auth_source, is_active)
          values ($1, $2, $3, 'ldap', true)
     on conflict (subject) do update
            set name = excluded.name,
                email = excluded.email,
                auth_source = 'ldap',
                is_active = true,
                updated_at = now()
       returning id`,
    [user.subject, user.name, user.email],
  );
  const id = rows[0].id;

  await client.query("delete from ecapital.app_user_role where app_user_id = $1", [id]);
  if (user.roles.length) {
    await client.query(
      `insert into ecapital.app_user_role (app_user_id, role)
            select $1, unnest($2::ecapital.app_role[])`,
      [id, user.roles],
    );
  }

  await client.query("delete from ecapital.app_user_org_unit where app_user_id = $1", [id]);
  if (user.orgUnitIds.length) {
    await client.query(
      `insert into ecapital.app_user_org_unit (app_user_id, org_unit_id)
            select $1, unnest($2::text[])`,
      [id, user.orgUnitIds],
    );
  }
  return id;
}
