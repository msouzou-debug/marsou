import { approvalRoleHolders, type ApprovalRole } from "@ecapital/shared";
import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

/**
 * Who an approval line waits on (§6.4, ADR-0026), in one place for the two
 * moments that ask: a permit submitted (`PermitsService.writeLine`) and an
 * account switched off or stripped of a role (`AdminUsersService.update`,
 * owner decision 26/11/2026).
 *
 * A line about one area asks that area's owner. A unit-wide line asks the
 * person holding that capacity for the unit, and falls back to an area owner
 * holding it where there is no unit-wide appointment — an Infection Control
 * officer appointed over the theatres and not over the hospital is still the
 * Infection Control officer. Earliest appointment first, always.
 *
 * RULE (owner decision 26/11/2026): an appointment counts only while its
 * person is active and holds an account role that may decide the line —
 * `approvalRoleHolders` in packages/shared/src/permit.ts, ADR-0039's two
 * lists. A switched-off account, or one whose role was taken away, keeps its
 * scope rows (switched back on, it keeps its appointments) and is passed over
 * as if it had none. The database answers the question through
 * `ecapital.eligible_approvers` (0036), because the person submitting a
 * permit may not read other people's accounts.
 *
 * No one found leaves the line unassigned and PENDING. That blocks the
 * permit, which is the strict reading and the right one: a route with a
 * signature missing is not an approved permit, and an administrator can
 * decide the line while somebody is appointed.
 *
 * RULE (ADR-0015's segregation principle, applied here per ADR-0026
 * Errata): the person who asked for the permit never resolves as the one who
 * signs off one of its own lines. When the natural answer is the requester,
 * another holder of the same role anywhere in the unit is looked for instead
 * (`anotherHolderInUnit`); when there is not one, the line is left unassigned
 * rather than handed back to its own requester — an administrator can still
 * decide it, subject to the same rule, once somebody else is appointed.
 */
export async function resolveApprover(
  orgUnitId: string,
  role: ApprovalRole,
  areaId: string | null,
  requestedById: string,
): Promise<string | null> {
  if (areaId) {
    const owners = await eligibleInOrder(
      role,
      await holders(schema.areaClinicalOwner, eq(schema.areaClinicalOwner.areaId, areaId), role),
    );
    const candidate = owners[0] ?? null;
    if (candidate === null || candidate === requestedById) {
      return anotherHolderInUnit(orgUnitId, role, requestedById);
    }
    return candidate;
  }

  const unitWide = await eligibleInOrder(
    role,
    await holders(schema.unitApprover, eq(schema.unitApprover.orgUnitId, orgUnitId), role),
  );
  if (unitWide.length && unitWide[0] !== requestedById) return unitWide[0];

  const byArea = await eligibleInOrder(
    role,
    await holders(schema.areaClinicalOwner, eq(schema.areaClinicalOwner.orgUnitId, orgUnitId), role),
  );
  if (byArea.length && byArea[0] !== requestedById) return byArea[0];

  if (unitWide.length || byArea.length) {
    // The only holder(s) found are the requester themselves — look further
    // before giving up.
    return anotherHolderInUnit(orgUnitId, role, requestedById);
  }
  return null;
}

/**
 * Any other eligible holder of `role` in the unit, unit-wide appointments
 * first — used only when the natural resolution above landed on the
 * requester or on nobody.
 */
async function anotherHolderInUnit(
  orgUnitId: string,
  role: ApprovalRole,
  excludeUserId: string,
): Promise<string | null> {
  const unitWide = await eligibleInOrder(
    role,
    await holders(
      schema.unitApprover,
      and(eq(schema.unitApprover.orgUnitId, orgUnitId), ne(schema.unitApprover.userId, excludeUserId)),
      role,
    ),
  );
  if (unitWide.length) return unitWide[0];

  const byArea = await eligibleInOrder(
    role,
    await holders(
      schema.areaClinicalOwner,
      and(
        eq(schema.areaClinicalOwner.orgUnitId, orgUnitId),
        ne(schema.areaClinicalOwner.userId, excludeUserId),
      ),
      role,
    ),
  );
  return byArea[0] ?? null;
}

type ScopeTable = typeof schema.areaClinicalOwner | typeof schema.unitApprover;

/** The people appointed to `role` in `table` under `where`, earliest appointment first. */
async function holders(
  table: ScopeTable,
  where: SQL | undefined,
  role: ApprovalRole,
): Promise<string[]> {
  const tx = currentTx();
  if (!tx) throw AppError.internal();
  const rows = await tx.db
    .select({ userId: table.userId })
    .from(table)
    .where(and(where, eq(table.approvalRole, role)))
    .orderBy(asc(table.createdAt));
  return rows.map((row) => row.userId);
}

/** `ids` in their order, keeping only the people who may hold a `role` line now. */
async function eligibleInOrder(role: ApprovalRole, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const eligible = await eligibleFor(role, ids);
  return [...new Set(ids)].filter((id) => eligible.has(id));
}

/**
 * Which of `userIds` are active and hold an account role that may decide a
 * `role` line (`approvalRoleHolders`). The handback acceptance asks it too,
 * with WARD_MANAGER standing for the three acceptance roles, which share one
 * rule.
 */
export async function eligibleFor(role: ApprovalRole, userIds: string[]): Promise<Set<string>> {
  const tx = currentTx();
  if (!tx) throw AppError.internal();
  if (!userIds.length) return new Set();
  const roles = [...approvalRoleHolders(role)];
  const { rows } = await tx.db.execute<{ user_id: string }>(
    sql`select user_id from ecapital.eligible_approvers(
          ${`{${[...new Set(userIds)].join(",")}}`}::uuid[],
          ${`{${roles.join(",")}}`}::text[])`,
  );
  return new Set(rows.map((row) => row.user_id));
}

/**
 * Owner decision 26/11/2026: when an administrator switches an account off
 * or takes away a role, every PENDING line of a permit in clinical review
 * that the person can no longer decide goes to the next eligible holder, by
 * the same resolution as a submission, or to nobody — which the screens show
 * as «nobody appointed» and the administrator can decide. Run inside the
 * administrator's own transaction, after the account is written, so the
 * person is already ineligible when the resolver looks.
 *
 * The audit trigger on `permit_approval` records each move with the
 * administrator as the actor and the old and new approver in the images, so
 * the permit's own history (`GET /permits/:id/audit`) shows it as
 * `permitLineReassigned`. Lines the person may still decide stay with them.
 *
 * Returns how many lines moved.
 */
export async function rerouteLinesOf(userId: string): Promise<number> {
  const tx = currentTx();
  if (!tx) throw AppError.internal();

  const lines = await tx.db
    .select({
      id: schema.permitApproval.id,
      orgUnitId: schema.permitApproval.orgUnitId,
      role: schema.permitApproval.role,
      areaId: schema.permitApproval.areaId,
      requestedById: schema.shutdownPermit.requestedBy,
    })
    .from(schema.permitApproval)
    .innerJoin(schema.shutdownPermit, eq(schema.shutdownPermit.id, schema.permitApproval.permitId))
    .where(
      and(
        eq(schema.permitApproval.approverId, userId),
        eq(schema.permitApproval.decision, "PENDING"),
        eq(schema.shutdownPermit.status, "CLINICAL_REVIEW"),
      ),
    )
    .orderBy(asc(schema.permitApproval.createdAt), asc(schema.permitApproval.id));

  let moved = 0;
  for (const line of lines) {
    if ((await eligibleFor(line.role, [userId])).has(userId)) continue;
    const next = await resolveApprover(line.orgUnitId, line.role, line.areaId, line.requestedById);
    const touched = await tx.db
      .update(schema.permitApproval)
      .set({ approverId: next, updatedAt: sql`now()` })
      .where(and(eq(schema.permitApproval.id, line.id), eq(schema.permitApproval.decision, "PENDING")))
      .returning({ id: schema.permitApproval.id });
    // A line the administrator can read and not write is one the role
    // matrix took away from them; the whole save is refused rather than
    // leaving it waiting on somebody who cannot decide it.
    if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    moved += 1;
  }
  return moved;
}
