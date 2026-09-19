import { Injectable } from "@nestjs/common";
import { ApproverScopes } from "@ecapital/shared";
import { asc, eq } from "drizzle-orm";
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
 *   **Only a clinical approver gets scopes.** A scope on somebody without the
 *   role grants nothing — the route resolves to them, the permit waits, and
 *   nobody can decide it. 422 with `errors.approverScopesNeedRole`.
 *
 *   **A replacement is one transaction.** The administrator sends the whole
 *   picture and gets the whole picture; a half-applied scope would leave a
 *   permit routed to somebody who has just been taken off the ward.
 *
 * Access is the controller's `@Roles("admin")` and the row policies of
 * migration 0015, which have said `admin` and nobody else since they were
 * written. Neither is decoration (ADR-0010).
 */
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

  async replace(userId: string, scopes: ApproverScopes): Promise<ApproverScopes> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.user(userId);

    const roles = await tx.db
      .select({ role: schema.appUserRole.role })
      .from(schema.appUserRole)
      .where(eq(schema.appUserRole.appUserId, userId));
    const holdsRole = roles.some((row) => row.role === "clinical_approver");
    if (!holdsRole && (scopes.areas.length || scopes.units.length)) {
      throw AppError.unprocessable("errors.approverScopesNeedRole");
    }

    // Every area has to exist and to be one the administrator may write to.
    // A scope over a room in a unit they cannot see is a scope they should
    // not be able to grant, and the policy refuses it anyway — this is what
    // turns that refusal into a sentence rather than a 403 with no subject.
    const areaUnits = new Map<string, string>();
    for (const scope of scopes.areas) {
      if (!UUID.test(scope.areaId)) throw AppError.notFound("errors.permitAreaNotFound");
      const rows = await tx.db
        .select({ orgUnitId: schema.area.orgUnitId })
        .from(schema.area)
        .where(eq(schema.area.id, scope.areaId))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.permitAreaNotFound");
      areaUnits.set(scope.areaId, rows[0].orgUnitId);
    }
    for (const scope of scopes.units) {
      const rows = await tx.db
        .select({ id: schema.orgUnit.id })
        .from(schema.orgUnit)
        .where(eq(schema.orgUnit.id, scope.orgUnitId))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.unitNotFound");
    }

    try {
      await tx.db
        .delete(schema.areaClinicalOwner)
        .where(eq(schema.areaClinicalOwner.userId, userId));
      await tx.db.delete(schema.unitApprover).where(eq(schema.unitApprover.userId, userId));

      for (const scope of scopes.areas) {
        await tx.db.insert(schema.areaClinicalOwner).values({
          areaId: scope.areaId,
          userId,
          // The trigger takes it from the area; the column is NOT NULL.
          orgUnitId: areaUnits.get(scope.areaId) as string,
          approvalRole: scope.role,
        });
      }
      for (const scope of scopes.units) {
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

    return this.read(userId);
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
