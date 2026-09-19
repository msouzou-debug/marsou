import { Injectable, Inject } from "@nestjs/common";
import {
  ROLE_SCOPE,
  isAdminProtectedRole,
  isAllUnitsRole,
  needsOrgUnits,
  type AdminUser,
  type AdminUserCreate,
  type AdminUserList,
  type AdminUserListQuery,
  type AdminUserUpdate,
  type AppRole,
  type RoleCatalogue,
} from "@ecapital/shared";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { AppError } from "../common/errors";
import { UUID, callerUserId } from "../common/actor";
import { CONFIG, type AppConfig } from "../config";
import { INSUFFICIENT_PRIVILEGE, UNIQUE_VIOLATION, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

/**
 * ADR-0020 — per-user role administration.
 *
 * Owner decision, 19/09/2026: roles are assigned to a person by an
 * administrator inside eCapital, the way eFinance does it. Active Directory
 * only authenticates. This service is the whole of that: who exists, what
 * they may do, which units they may do it in, and whether their account is
 * still on.
 *
 * Access to the routes themselves is the controller's `@Roles("admin")`; who
 * may write these three tables is the row policies' (ADR-0010), which already
 * say `admin` and nobody else. What is in this file is neither of those: it
 * is the four rules an administrator can break without meaning to, each of
 * which is a 422 with a sentence, not a 403.
 */
@Injectable()
export class AdminUsersService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** The eight roles and their scope, so no client hardcodes either. */
  catalogue(): RoleCatalogue {
    return (Object.keys(ROLE_SCOPE) as AppRole[]).map((role) => ({ role, scope: ROLE_SCOPE[role] }));
  }

  async list(query: AdminUserListQuery): Promise<AdminUserList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const filters: SQL[] = [];
    if (query.q.trim()) {
      const term = `%${query.q.trim().toLowerCase()}%`;
      filters.push(
        sql`(lower(${schema.appUser.name}) like ${term}
          or lower(coalesce(${schema.appUser.username}, ${schema.appUser.email})) like ${term}
          or lower(${schema.appUser.email}) like ${term})`,
      );
    }
    if (query.active !== undefined) filters.push(eq(schema.appUser.isActive, query.active));
    if (query.role.length) {
      filters.push(
        inArray(
          schema.appUser.id,
          tx.db
            .select({ id: schema.appUserRole.appUserId })
            .from(schema.appUserRole)
            .where(inArray(schema.appUserRole.role, query.role)),
        ),
      );
    }
    if (query.unit.length) {
      filters.push(
        inArray(
          schema.appUser.id,
          tx.db
            .select({ id: schema.appUserOrgUnit.appUserId })
            .from(schema.appUserOrgUnit)
            .where(inArray(schema.appUserOrgUnit.orgUnitId, query.unit)),
        ),
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    const [{ total }] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.appUser)
      .where(where);

    const rows = await tx.db
      .select(userColumns)
      .from(schema.appUser)
      .where(where)
      .orderBy(asc(schema.appUser.name), asc(schema.appUser.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const items = await this.withRolesAndUnits(rows);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string): Promise<AdminUser> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.adminUserNotFound");
    const rows = await tx.db
      .select(userColumns)
      .from(schema.appUser)
      .where(eq(schema.appUser.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.adminUserNotFound");
    const [user] = await this.withRolesAndUnits(rows);
    return user;
  }

  /**
   * Pre-register an account before its first sign-in (ADR-0020).
   *
   * RULE: the subject is `ad:<username>` until the first Active Directory
   * bind replaces it with the objectGUID. `auth.service.ts` does the swap by
   * matching on `username`, so the roles set here are the roles the person
   * has the first time they ever open eCapital — which is the only reason to
   * pre-register at all.
   *
   * In `dev` mode the same route writes a seeded-style account instead: the
   * stub signs people in by address, so the derived address is the one they
   * use.
   */
  async create(input: AdminUserCreate): Promise<AdminUser> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const username = input.username.trim();
    const roles = unique(input.roles);
    this.refuseProtectedRoles(roles, []);

    const orgUnitIds = await this.resolveOrgUnits(roles, input.orgUnitIds);
    const dev = this.config.authMode === "dev";
    const subject = `${dev ? "dev" : "ad"}:${username.toLowerCase()}`;
    const email = (input.email?.trim() || `${username}@${this.defaultDomain()}`).toLowerCase();

    try {
      const [row] = await tx.db
        .insert(schema.appUser)
        .values({
          subject,
          username,
          name: input.name?.trim() || username,
          email,
          authSource: dev ? "dev" : this.config.authMode,
          isActive: true,
        })
        .returning({ id: schema.appUser.id });

      await this.writeRoles(row.id, roles);
      await this.writeOrgUnits(row.id, orgUnitIds);
      return await this.detail(row.id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const state = sqlState(error);
      if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
      if (state === UNIQUE_VIOLATION) {
        throw AppError.unprocessable("errors.usernameTaken", { username });
      }
      throw error;
    }
  }

  /**
   * Change somebody's roles, units, display name or whether their account is
   * on. Every rule below is a 422 with a sentence the administrator can act
   * on, never a silent no-op.
   */
  async update(id: string, input: AdminUserUpdate): Promise<AdminUser> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const current = await this.detail(id);
    const actorId = await callerUserId();

    const nextRoles = input.roles === undefined ? current.roles : unique(input.roles);
    const nextActive = input.active === undefined ? current.active : input.active;

    // RULE (a) (ADR-0020): an administrator cannot lock themselves out. Not
    // by dropping their own `admin`, not by switching their own account off.
    // Either would need a second administrator — or the server's CLI — to
    // undo, and the person who did it is exactly the person who can no
    // longer undo it.
    if (id === actorId) {
      const losingAdmin = current.roles.includes("admin") && !nextRoles.includes("admin");
      if (losingAdmin || input.active === false) {
        throw AppError.unprocessable("errors.selfLockout");
      }
    }

    // RULE (b) (ADR-0020): the system keeps at least one active
    // administrator. Without one, nobody can assign a role again and the only
    // way back is `grant-admin` on the server — which is a real way back, but
    // not one to arrive at by accident on a Friday afternoon.
    const stillAdmin = nextActive && nextRoles.includes("admin");
    const wasAdmin = current.active && current.roles.includes("admin");
    if (wasAdmin && !stillAdmin && (await this.activeAdminCount(id)) === 0) {
      throw AppError.unprocessable("errors.lastAdmin");
    }

    // RULE (c) (CAPEX-01 §10, ADR-0020): the auditor "cannot be edited by
    // admin". Granting or revoking `auditor_readonly` is the bootstrap CLI's
    // and nobody else's — an administrator who could appoint the person who
    // audits them is not an audit trail, it is a formality.
    if (input.roles !== undefined) this.refuseProtectedRoles(nextRoles, current.roles);

    const nextUnits =
      input.orgUnitIds === undefined && input.roles === undefined
        ? current.orgUnitIds
        : await this.resolveOrgUnits(nextRoles, input.orgUnitIds ?? current.orgUnitIds);

    try {
      const touched = await tx.db
        .update(schema.appUser)
        .set({
          updatedAt: sql`now()`,
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.active === undefined ? {} : { isActive: input.active }),
        })
        .where(eq(schema.appUser.id, id))
        .returning({ id: schema.appUser.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");

      if (input.roles !== undefined) await this.writeRoles(id, nextRoles);
      if (input.orgUnitIds !== undefined || input.roles !== undefined) {
        await this.writeOrgUnits(id, nextUnits);
      }
      return await this.detail(id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  // ------------------------------------------------------------------ rules

  /** RULE (c). Granting it and taking it away are equally refused. */
  private refuseProtectedRoles(next: AppRole[], current: AppRole[]): void {
    for (const role of [...new Set([...next, ...current])]) {
      if (!isAdminProtectedRole(role)) continue;
      if (next.includes(role) !== current.includes(role)) {
        throw AppError.unprocessable("errors.auditorProtected");
      }
    }
  }

  /**
   * RULE (d) (ADR-0020): a role that only means something against a list of
   * units needs at least one. A role that reaches every unit ignores the list
   * the caller sent and carries all of them instead — `admin`,
   * `executive_readonly` and `auditor_readonly` see every unit through the
   * row policies whatever the list says, and `finance` does not, so for
   * finance the expansion is what actually grants the access.
   */
  private async resolveOrgUnits(roles: AppRole[], requested: string[]): Promise<string[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    if (roles.some(isAllUnitsRole)) {
      const all = await tx.db.select({ id: schema.orgUnit.id }).from(schema.orgUnit);
      return all.map((u) => u.id).sort();
    }

    const wanted = unique(requested);
    if (needsOrgUnits(roles) && !wanted.length) throw AppError.unprocessable("errors.unitRequired");
    if (!wanted.length) return [];

    const known = await tx.db
      .select({ id: schema.orgUnit.id })
      .from(schema.orgUnit)
      .where(inArray(schema.orgUnit.id, wanted));
    if (known.length !== wanted.length) throw AppError.unprocessable("errors.unitNotFound");
    return wanted.sort();
  }

  /** How many active administrators there would be without `excludingId`. */
  private async activeAdminCount(excludingId: string): Promise<number> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [{ total }] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.appUser)
      .innerJoin(schema.appUserRole, eq(schema.appUserRole.appUserId, schema.appUser.id))
      .where(
        and(
          eq(schema.appUser.isActive, true),
          eq(schema.appUserRole.role, "admin"),
          sql`${schema.appUser.id} <> ${excludingId}`,
        ),
      );
    return total;
  }

  // ------------------------------------------------------------------ writes

  /**
   * RULE (e) (R42): these two tables carry the audit triggers 0001 installed,
   * so a role granted and a role taken away are both a row in `audit_log`
   * with the before and after image. Nothing here writes that log by hand and
   * nothing here could — the application role has no insert grant on it.
   */
  private async writeRoles(userId: string, roles: AppRole[]): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await tx.db.delete(schema.appUserRole).where(eq(schema.appUserRole.appUserId, userId));
    for (const role of roles) {
      await tx.db.insert(schema.appUserRole).values({ appUserId: userId, role });
    }
  }

  private async writeOrgUnits(userId: string, orgUnitIds: string[]): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await tx.db.delete(schema.appUserOrgUnit).where(eq(schema.appUserOrgUnit.appUserId, userId));
    for (const orgUnitId of orgUnitIds) {
      await tx.db.insert(schema.appUserOrgUnit).values({ appUserId: userId, orgUnitId });
    }
  }

  // ------------------------------------------------------------------ rows

  private async withRolesAndUnits(
    rows: { id: string; subject: string; username: string | null; name: string; email: string; authSource: string; isActive: boolean; lastSignInAt: Date | null; createdAt: Date }[],
  ): Promise<AdminUser[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);

    const roleRows = await tx.db
      .select({ appUserId: schema.appUserRole.appUserId, role: schema.appUserRole.role })
      .from(schema.appUserRole)
      .where(inArray(schema.appUserRole.appUserId, ids));
    const unitRows = await tx.db
      .select({ appUserId: schema.appUserOrgUnit.appUserId, orgUnitId: schema.appUserOrgUnit.orgUnitId })
      .from(schema.appUserOrgUnit)
      .where(inArray(schema.appUserOrgUnit.appUserId, ids));

    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      // The M0 seed wrote rows before `username` existed; those accounts sign
      // in by address, so the address is what stands in for one.
      username: row.username ?? row.email,
      name: row.name,
      email: row.email,
      authSource: (["dev", "ldap", "oidc"].includes(row.authSource) ? row.authSource : "oidc") as AdminUser["authSource"],
      active: row.isActive,
      roles: roleRows.filter((r) => r.appUserId === row.id).map((r) => r.role).sort(),
      orgUnitIds: unitRows.filter((u) => u.appUserId === row.id).map((u) => u.orgUnitId).sort(),
      lastSignInAt: row.lastSignInAt ? row.lastSignInAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** `dev` accounts sign in by address; AD accounts by UPN. */
  private defaultDomain(): string {
    if (this.config.authMode === "dev") return "ecapital.test";
    return this.config.LDAP_DOMAIN ?? "ihcis.local";
  }
}

const userColumns = {
  id: schema.appUser.id,
  subject: schema.appUser.subject,
  username: schema.appUser.username,
  name: schema.appUser.name,
  email: schema.appUser.email,
  authSource: schema.appUser.authSource,
  isActive: schema.appUser.isActive,
  lastSignInAt: schema.appUser.lastSignInAt,
  createdAt: schema.appUser.createdAt,
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
