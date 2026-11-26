import { Injectable } from "@nestjs/common";
import {
  ApproverScopes,
  approverScopesRefusal,
  type AppRole,
  type ApproverAreaScope,
  type ApproverUnitScope,
} from "@ecapital/shared";
import { asc, eq, inArray } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import { INSUFFICIENT_PRIVILEGE, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

/**
 * M3 on ADR-0020's screen: which areas and which units a clinical approver
 * answers for (CAPEX-01 §6.4 and §9).
 *
 * ADR-0020 settled that roles are assigned per user by an administrator
 * inside eCapital, and this is the same decision one level down. §6.4 routes
 * a permit to «the ward/department manager for every clinical area touched»
 * and to the officers who answer for the hospital, and §9 says a clinical
 * approver «sees only permits touching their areas» — both of which need a
 * table saying whose areas those are. CAPEX-01 §4 has
 * `area.clinical_owner_group_id`, an Entra group, which is exactly the model
 * ADR-0020 stopped using.
 *
 * Two rules, each said once here and once where it matters:
 *
 *   **Only a role that can decide the line gets the scope.** A scope on
 *   somebody without the role grants nothing — the route resolves to them,
 *   the permit waits, and nobody can decide it. ADR-0039 (owner decision
 *   26/11/2026): a TECHNICAL or SAFETY unit scope goes to a technical and
 *   safety approver, a clinical approver or an estates head, 422 with
 *   `errors.approverScopesNeedTechnicalRole` otherwise; every other scope,
 *   by area or by unit, still goes to a clinical approver alone, 422 with
 *   `errors.approverScopesNeedRole`. The rule is `approverScopesRefusal` in
 *   packages/shared/src/permit.ts, which S24's editor reads too.
 *
 *   **A replacement is one transaction.** The administrator sends the whole
 *   picture and gets the whole picture; a half-applied scope would leave a
 *   permit routed to somebody who has just been taken off the ward. Since
 *   26/11/2026 that transaction is normally the whole sheet's: the scopes
 *   come with the roles in `PATCH /admin/users/:id`, are judged against the
 *   roles of that same save, and only the rows that changed are written.
 *
 * Access is the controller's `@Roles("admin")` and the row policies of
 * migration 0015, which have said `admin` and nobody else since they were
 * written. Neither is decoration (ADR-0010).
 */
/** What one save changes, worked out and checked before anything is written. */
export interface ScopePlan {
  addAreas: (ApproverAreaScope & { orgUnitId: string })[];
  addUnits: ApproverUnitScope[];
  removeAreaIds: string[];
  removeUnitIds: string[];
}

@Injectable()
export class ApproverScopesService {
  async read(userId: string): Promise<ApproverScopes> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.user(userId);

    const areas = await tx.db
      .select({
        areaId: schema.areaClinicalOwner.areaId,
        role: schema.areaClinicalOwner.approvalRole,
      })
      .from(schema.areaClinicalOwner)
      .where(eq(schema.areaClinicalOwner.userId, userId))
      .orderBy(asc(schema.areaClinicalOwner.areaId), asc(schema.areaClinicalOwner.approvalRole));

    const units = await tx.db
      .select({
        orgUnitId: schema.unitApprover.orgUnitId,
        role: schema.unitApprover.approvalRole,
      })
      .from(schema.unitApprover)
      .where(eq(schema.unitApprover.userId, userId))
      .orderBy(asc(schema.unitApprover.orgUnitId), asc(schema.unitApprover.approvalRole));

    // `ApproverScopes` narrows the roles by where they apply: a WARD_MANAGER
    // is never unit-wide and a HOSPITAL_DIRECTOR is never one room's. A row
    // that does not fit is data somebody wrote around the screen, and the
    // parse is what says so rather than the screen drawing it wrong.
    return ApproverScopes.parse({ areas, units });
  }

  /**
   * `PUT /admin/users/:id/approver-scopes`, kept for compatibility: the sheet
   * now saves the scopes with the roles through `PATCH /admin/users/:id`
   * (owner decision 26/11/2026). Checked against the roles the account holds
   * now, because this route does not change them.
   */
  async replace(userId: string, scopes: ApproverScopes): Promise<ApproverScopes> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.user(userId);

    const roles = await tx.db
      .select({ role: schema.appUserRole.role })
      .from(schema.appUserRole)
      .where(eq(schema.appUserRole.appUserId, userId));
    const plan = await this.plan(
      userId,
      scopes,
      roles.map((row) => row.role),
    );
    await this.apply(userId, plan);
    return this.read(userId);
  }

  /**
   * What saving `scopes` would change, checked, before anything is written.
   *
   * RULE (ADR-0039): only a role that can decide the line gets the scope,
   * judged against `roles` — the roles the same save gives the account, so
   * ticking a role and adding its scope in one go is one valid save (owner
   * decision 26/11/2026). What is judged is what the save **adds**: a scope
   * the account already holds and keeps is not a grant, and since the same
   * decision keeps scope rows on an account that loses its role (switched
   * back, it has them again; meanwhile routing passes it over), a save that
   * keeps one is not refused for it.
   *
   * Every added area has to exist and to be one the administrator may write
   * to. A scope over a room in a unit they cannot see is a scope they should
   * not be able to grant, and the policy refuses it anyway — this is what
   * turns that refusal into a sentence rather than a 403 with no subject.
   */
  async plan(userId: string, scopes: ApproverScopes, roles: AppRole[]): Promise<ScopePlan> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const savedAreas = await tx.db
      .select({
        id: schema.areaClinicalOwner.id,
        areaId: schema.areaClinicalOwner.areaId,
        role: schema.areaClinicalOwner.approvalRole,
      })
      .from(schema.areaClinicalOwner)
      .where(eq(schema.areaClinicalOwner.userId, userId));
    const savedUnits = await tx.db
      .select({
        id: schema.unitApprover.id,
        orgUnitId: schema.unitApprover.orgUnitId,
        role: schema.unitApprover.approvalRole,
      })
      .from(schema.unitApprover)
      .where(eq(schema.unitApprover.userId, userId));

    const areaKey = (scope: { areaId: string; role: string }) => `${scope.areaId}|${scope.role}`;
    const unitKey = (scope: { orgUnitId: string; role: string }) => `${scope.orgUnitId}|${scope.role}`;
    const wantedAreas = new Map(scopes.areas.map((scope) => [areaKey(scope), scope]));
    const wantedUnits = new Map(scopes.units.map((scope) => [unitKey(scope), scope]));
    const heldAreas = new Set(savedAreas.map(areaKey));
    const heldUnits = new Set(savedUnits.map(unitKey));

    const added: ApproverScopes = {
      areas: [...wantedAreas.entries()].filter(([key]) => !heldAreas.has(key)).map(([, scope]) => scope),
      units: [...wantedUnits.entries()].filter(([key]) => !heldUnits.has(key)).map(([, scope]) => scope),
    };
    const refusal = approverScopesRefusal(roles, added);
    if (refusal) throw AppError.unprocessable(refusal);

    const areaUnits = new Map<string, string>();
    for (const scope of added.areas) {
      if (!UUID.test(scope.areaId)) throw AppError.notFound("errors.permitAreaNotFound");
      const rows = await tx.db
        .select({ orgUnitId: schema.area.orgUnitId })
        .from(schema.area)
        .where(eq(schema.area.id, scope.areaId))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.permitAreaNotFound");
      areaUnits.set(scope.areaId, rows[0].orgUnitId);
    }
    for (const scope of added.units) {
      const rows = await tx.db
        .select({ id: schema.orgUnit.id })
        .from(schema.orgUnit)
        .where(eq(schema.orgUnit.id, scope.orgUnitId))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.unitNotFound");
    }

    return {
      addAreas: added.areas.map((scope) => ({ ...scope, orgUnitId: areaUnits.get(scope.areaId) as string })),
      addUnits: added.units,
      removeAreaIds: savedAreas.filter((row) => !wantedAreas.has(areaKey(row))).map((row) => row.id),
      removeUnitIds: savedUnits.filter((row) => !wantedUnits.has(unitKey(row))).map((row) => row.id),
    };
  }

  /**
   * Write only what changed (owner decision 26/11/2026): a scope kept is not
   * touched, so the audit log shows the rows that were added and removed and
   * nothing else, and a kept appointment keeps its place in the
   * earliest-appointment-first order.
   */
  async apply(userId: string, plan: ScopePlan): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    try {
      if (plan.removeAreaIds.length) {
        await tx.db
          .delete(schema.areaClinicalOwner)
          .where(inArray(schema.areaClinicalOwner.id, plan.removeAreaIds));
      }
      if (plan.removeUnitIds.length) {
        await tx.db.delete(schema.unitApprover).where(inArray(schema.unitApprover.id, plan.removeUnitIds));
      }
      for (const scope of plan.addAreas) {
        await tx.db.insert(schema.areaClinicalOwner).values({
          areaId: scope.areaId,
          userId,
          // The trigger takes it from the area; the column is NOT NULL.
          orgUnitId: scope.orgUnitId,
          approvalRole: scope.role,
        });
      }
      for (const scope of plan.addUnits) {
        await tx.db.insert(schema.unitApprover).values({
          orgUnitId: scope.orgUnitId,
          userId,
          approvalRole: scope.role,
        });
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  /** An account that does not exist is a 404, the same as everywhere else. */
  private async user(userId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(userId)) throw AppError.notFound("errors.adminUserNotFound");
    const rows = await tx.db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(eq(schema.appUser.id, userId))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.adminUserNotFound");
  }
}
