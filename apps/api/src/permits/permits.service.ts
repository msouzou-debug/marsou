import { Inject, Injectable } from "@nestjs/common";
import {
  AffectedArea,
  ShutdownPermit,
  type AuditEntry,
  type ApprovalDecisionWrite,
  type ApprovalRole,
  type IcraSubmission,
  type PermitApproval,
  type PermitListQuery,
  type PermitListRow,
  type PermitStatus,
  type PermitTransition,
  type ShutdownPermitDraft,
} from "@ecapital/shared";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { CONFIG, type AppConfig } from "../config";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  RESTRICT_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { IcraService } from "../icra/icra.service";
import { missingAcknowledgements } from "../icra/icra-engine";
import { SystemFeedsService } from "../system-feeds/system-feeds.service";
import { findClashes, type Clash, type ClashCandidate } from "./clashes";
import { ilsmFor } from "./ilsm";
import {
  AUDIT_LINES,
  LIVE_PERMIT_STATUSES,
  checklistComplete,
  insideWindow,
  toApproval,
  toListRow,
  toPermit,
  toPermitAuditEntry,
  type ApprovalRow,
  type PermitAuditRow,
  type PermitRow,
} from "./permit-rows";
import { approvalSlaWindow } from "./permit-sla";
import { durationHours, routeFor, type RouteLine } from "./routing";

/** §6.6: who may sign the clinical acceptance that closes a permit. */
const ACCEPTANCE_ROLES: ApprovalRole[] = ["WARD_MANAGER", "NURSING", "INFECTION_CONTROL"];

/**
 * M3 — Διακοπή συστήματος και άδεια εργασίας (R19, R21–R24).
 *
 * CAPEX-01 §6: «request → ICRA wizard → ILSM check → routing → clinical
 * approval → active → closeout.» Each of those is a method here, and each
 * carries the line of the brief it comes from.
 *
 * There is no unit check in this file and there is not meant to be one
 * (ADR-0010). A permit in a unit the caller may not see does not exist for
 * them: the select returns nothing and the answer is 404. What *is* checked
 * here is everything the row policies cannot express — whether the permit is
 * in a state where this transition is allowed, whether this caller is the
 * person this line is waiting on, and whether the boxes are all ticked.
 */
@Injectable()
export class PermitsService {
  constructor(
    private readonly icra: IcraService,
    private readonly feeds: SystemFeedsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------- reading --

  async list(query: PermitListQuery): Promise<{ items: PermitListRow[]; total: number }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const clauses: SQL[] = [];
    if (query.orgUnitId) clauses.push(eq(schema.shutdownPermit.orgUnitId, query.orgUnitId));
    if (query.status?.length) clauses.push(inArray(schema.shutdownPermit.status, query.status));
    if (query.system) {
      clauses.push(sql`${query.system}::ecapital.permit_system = any (${schema.shutdownPermit.systems})`);
    }
    if (query.from) clauses.push(gte(schema.shutdownPermit.plannedEnd, new Date(query.from)));
    if (query.to) clauses.push(lte(schema.shutdownPermit.plannedStart, new Date(query.to)));
    if (query.q) {
      const like = `%${query.q}%`;
      clauses.push(
        sql`(${schema.shutdownPermit.titleEl} ilike ${like} or coalesce(${schema.shutdownPermit.ref}, '') ilike ${like})`,
      );
    }
    if (query.areaType) {
      clauses.push(
        sql`exists (select 1 from ecapital.shutdown_permit_area spa
                     join ecapital.area a on a.id = spa.area_id
                    where spa.permit_id = ${schema.shutdownPermit.id}
                      and a.area_type = ${query.areaType}::ecapital.area_type)`,
      );
    }
    const where = clauses.length ? and(...clauses) : undefined;

    const [{ total }] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.shutdownPermit)
      .where(where);

    const rows = await tx.db
      .select({
        id: schema.shutdownPermit.id,
        ref: schema.shutdownPermit.ref,
        orgUnitId: schema.shutdownPermit.orgUnitId,
        orgUnitNameEl: schema.orgUnit.nameEl,
        // S03's «Ανοικτές άδειες» card filters on this rather than fetching
        // every permit's detail (reconciled with the web agent, 19/09/2026).
        projectId: schema.shutdownPermit.projectId,
        titleEl: schema.shutdownPermit.titleEl,
        systems: schema.shutdownPermit.systems,
        plannedStart: schema.shutdownPermit.plannedStart,
        plannedEnd: schema.shutdownPermit.plannedEnd,
        status: schema.shutdownPermit.status,
        breachedAt: schema.shutdownPermit.breachedAt,
        icraClass: schema.shutdownPermit.icraClass,
      })
      .from(schema.shutdownPermit)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.shutdownPermit.orgUnitId))
      .where(where)
      .orderBy(desc(schema.shutdownPermit.plannedStart), desc(schema.shutdownPermit.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const ids = rows.map((row) => row.id);
    const areaRows = ids.length
      ? await tx.db
          .select({
            permitId: schema.shutdownPermitArea.permitId,
            patientRiskGroup: schema.area.patientRiskGroup,
          })
          .from(schema.shutdownPermitArea)
          .innerJoin(schema.area, eq(schema.area.id, schema.shutdownPermitArea.areaId))
          .where(inArray(schema.shutdownPermitArea.permitId, ids))
      : [];
    const pendingRows = ids.length
      ? await tx.db
          .select({
            permitId: schema.permitApproval.permitId,
            pending: sql<number>`count(*)::int`,
          })
          .from(schema.permitApproval)
          .where(
            and(
              inArray(schema.permitApproval.permitId, ids),
              eq(schema.permitApproval.decision, "PENDING"),
            ),
          )
          .groupBy(schema.permitApproval.permitId)
      : [];
    const pendingBy = new Map(pendingRows.map((row) => [row.permitId, row.pending]));

    return {
      total,
      items: rows.map((row) => {
        const areas = areaRows.filter((a) => a.permitId === row.id);
        return toListRow({
          ...row,
          areaCount: areas.length,
          riskGroups: areas.map((a) => a.patientRiskGroup),
          pendingApprovals: pendingBy.get(row.id) ?? 0,
        });
      }),
    };
  }

  async one(id: string, now: Date): Promise<ShutdownPermit> {
    const row = await this.row(id);
    const [areas, approvals] = await Promise.all([this.areasOf(id), this.approvalsOf(id, now)]);
    return ShutdownPermit.parse(toPermit(row, areas, approvals));
  }

  // ------------------------------------------------------------- writing --

  /**
   * RULE (§6.1): the engineer picks the systems and the areas, and the system
   * works out what else is downstream. The impact is resolved once, here, and
   * stored — a permit is a decision about a set of rooms and that set has to
   * be the one people signed, not one recomputed after somebody edited a feed.
   */
  async create(input: ShutdownPermitDraft, now: Date): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const caller = await callerUserId();

    // RULE (S11 autosave): step 1 is title, work kind and systems, and the
    // request is created there. The areas arrive at step 2 and the window at
    // step 3, both as PATCHes, and neither is invented here — a provisional
    // window is flagged as provisional so the submission can refuse it.
    const areaIds = input.affectedAreaIds ?? [];
    const orgUnitId = areaIds.length
      ? await this.unitOfAreas(areaIds)
      : await this.unitOfCaller(input.projectId, input.contractId);
    const affected = areaIds.length
      ? await this.feeds.impact(orgUnitId, input.systems, areaIds)
      : [];
    const window = this.window(input.plannedStart, input.plannedEnd, now);

    try {
      const [row] = await tx.db
        .insert(schema.shutdownPermit)
        .values({
          orgUnitId,
          projectId: input.projectId,
          contractId: input.contractId,
          titleEl: input.titleEl,
          descriptionEl: input.descriptionEl,
          workKind: input.workKind,
          systems: input.systems,
          plannedStart: window.start,
          plannedEnd: window.end,
          windowProvisional: window.provisional,
          contingencyPlanEl: input.contingencyPlanEl,
          // RULE (§6.3): the triggers are recorded from the first save; the
          // measures are worked out at submission, when the answer matters.
          ilsm: ilsmFor(input.ilsmTriggers, input.systems),
          status: "DRAFT",
          requestedBy: caller,
          requestedAt: now,
        })
        .returning({ id: schema.shutdownPermit.id });

      await this.writeAreas(row.id, orgUnitId, affected);
      return await this.one(row.id, now);
    } catch (error) {
      throw this.writeError(error);
    }
  }

  /** RULE: a draft is editable; everything past it is a decision somebody took. */
  async patch(id: string, input: Partial<ShutdownPermitDraft>, now: Date): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    if (existing.status !== "DRAFT") throw AppError.unprocessable("errors.permitNotDraft");

    const systems = input.systems ?? existing.systems;
    // A PATCH that names neither date leaves the window as it was — which
    // means a provisional one stays provisional, and a real one stays real.
    const givesDates = input.plannedStart !== undefined || input.plannedEnd !== undefined;
    const window = givesDates
      ? this.window(
          input.plannedStart ?? existing.plannedStart.toISOString(),
          input.plannedEnd ?? existing.plannedEnd.toISOString(),
          now,
        )
      : {
          start: existing.plannedStart,
          end: existing.plannedEnd,
          provisional: existing.windowProvisional,
        };

    let affected: AffectedArea[] | null = null;
    if (input.affectedAreaIds || input.systems) {
      const areaIds =
        input.affectedAreaIds ??
        (await this.areasOf(id)).filter((a) => a.impact === "DIRECT").map((a) => a.areaId);
      if (areaIds.length) {
        const orgUnitId = await this.unitOfAreas(areaIds);
        if (orgUnitId !== existing.orgUnitId) {
          throw AppError.unprocessable("errors.permitUnitFixed");
        }
        affected = await this.feeds.impact(orgUnitId, systems, areaIds);
      } else {
        // Step 2 unticked everything again. An empty draft is a state the
        // wizard can be in, and the submission is what refuses it.
        affected = [];
      }
    }

    try {
      const touched = await tx.db
        .update(schema.shutdownPermit)
        .set({
          projectId: input.projectId === undefined ? existing.projectId : input.projectId,
          contractId: input.contractId === undefined ? existing.contractId : input.contractId,
          titleEl: input.titleEl ?? existing.titleEl,
          descriptionEl: input.descriptionEl ?? existing.descriptionEl,
          workKind: input.workKind ?? existing.workKind,
          systems,
          plannedStart: window.start,
          plannedEnd: window.end,
          windowProvisional: window.provisional,
          contingencyPlanEl:
            input.contingencyPlanEl === undefined
              ? existing.contingencyPlanEl
              : input.contingencyPlanEl,
          ilsm: ilsmFor(input.ilsmTriggers ?? existing.ilsm?.triggers ?? [], systems),
          updatedAt: sql`now()`,
        })
        .where(eq(schema.shutdownPermit.id, id))
        .returning({ id: schema.shutdownPermit.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");

      if (affected) {
        await tx.db
          .delete(schema.shutdownPermitArea)
          .where(eq(schema.shutdownPermitArea.permitId, id));
        await this.writeAreas(id, existing.orgUnitId, affected);
      }
    } catch (error) {
      throw this.writeError(error);
    }
    return this.one(id, now);
  }

  /**
   * The ICRA wizard's answer, stored (R20, §6.2).
   *
   * Two refusals, both 422 and both clinical-safety rules said twice — here
   * and in the engine's own unit tests:
   *
   *   `classTwoInvalidForWorks` — «Class II is never valid for construction
   *   or renovation» (§2). The wizard disables Υποβολή; this is what makes it
   *   true of anything that calls the API directly.
   *
   *   `permitControlsNotAcknowledged` — UI §5 S12 requires every control on
   *   the checklist to be ticked before submission. A browser enables a
   *   button; the server is what makes the tick mean something.
   */
  async submitIcra(id: string, input: IcraSubmission, now: Date): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    if (existing.status !== "DRAFT") throw AppError.unprocessable("errors.permitNotDraft");

    const areas = await this.areasOf(id);
    if (!areas.length) throw AppError.unprocessable("errors.permitNoAreas");
    const surrounding = await this.icra.withResolvedSurrounding(input.surrounding);

    const result = await this.icra.evaluate({
      activityType: input.activityType,
      // RULE (§6.1, §6.2): the risk group is the highest of **all** affected
      // areas, the indirect ones included, plus the surrounding assessment.
      affectedAreaIds: areas.map((area) => area.areaId),
      surrounding,
      workKind: existing.workKind,
    });

    if (result.refusalKey) {
      throw AppError.unprocessable(`errors.${result.refusalKey}`);
    }
    const missing = missingAcknowledgements(result.controls, input.acknowledgedControlIds);
    if (missing.length) {
      throw AppError.unprocessable("errors.permitControlsNotAcknowledged", {
        count: String(missing.length),
      });
    }

    try {
      const touched = await tx.db
        .update(schema.shutdownPermit)
        .set({
          icra: result,
          icraClass: result.icraClass,
          surrounding,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.shutdownPermit.id, id))
        .returning({ id: schema.shutdownPermit.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      throw this.writeError(error);
    }
    return this.one(id, now);
  }

  async transition(id: string, input: PermitTransition, now: Date): Promise<ShutdownPermit> {
    switch (input.to) {
      case "SUBMITTED":
        return this.submit(id, now);
      case "ACTIVE":
        return this.activate(id, now);
      case "CLOSED":
        return this.close(id, input, now);
      case "REJECTED":
        return this.reject(id, input, now);
    }
  }

  // ------------------------------------------------------- transitions --

  /**
   * §6.4 and §6.7, in one transaction: the ICRA has to be done, ILSM is
   * settled, the reference is allocated, the route is built, and the clashes
   * are found and warned about.
   */
  private async submit(id: string, now: Date): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    if (existing.status !== "DRAFT") throw AppError.unprocessable("errors.permitNotDraft");
    // RULE (§6.2, §6.4): no class, no route. The route is derived from the
    // class, so a permit submitted without one would be routed to nobody.
    if (!existing.icra) throw AppError.unprocessable("errors.permitIcraRequired");

    // RULE (§6.1, §6.4): what the wizard's steps 2 and 3 answer. The draft is
    // allowed to be half-finished; the submission is not.
    const areas = await this.areasOf(id);
    if (!areas.length) throw AppError.unprocessable("errors.permitNoAreas");
    if (existing.windowProvisional) {
      throw AppError.unprocessable("errors.permitWindowRequired");
    }
    if (existing.plannedEnd.getTime() <= existing.plannedStart.getTime()) {
      throw AppError.unprocessable("errors.permitWindowBackwards");
    }
    const ilsm = ilsmFor(existing.ilsm?.triggers ?? [], existing.systems);
    const hours = durationHours(existing.plannedStart, existing.plannedEnd);

    const lines = routeFor({
      icraClass: existing.icra.icraClass,
      areas: areas.map((area) => ({
        areaId: area.areaId,
        areaNameEl: area.nameEl,
        areaType: area.areaType,
      })),
      ilsmRequired: ilsm.required,
      durationHours: hours,
      directorThresholdHours: this.config.PERMIT_DIRECTOR_THRESHOLD_HOURS,
    });

    const clashes = await this.clashesFor(existing, areas, now);

    try {
      // RULE (ADR-0019's shape, ADR-0014's machinery): the reference is
      // allocated on submission, not on draft — a draft nobody ever sends
      // should not burn a number — and never twice. A permit that was
      // returned and resubmitted keeps the reference it was printed with.
      let ref = existing.ref;
      if (!ref) {
        const [{ allocated }] = await tx.db
          .select({
            allocated: sql<string>`ecapital.allocate_permit_ref(${existing.orgUnitId}, ${now.getUTCFullYear()}::int)`,
          })
          .from(sql`(select 1) as one`);
        ref = allocated;
      }

      // The route is rebuilt from scratch on every submission. A permit that
      // came back RETURNED may have moved to different areas or a different
      // class, and a stale line would ask the wrong person the wrong question.
      await tx.db.delete(schema.permitApproval).where(eq(schema.permitApproval.permitId, id));
      for (const line of lines) {
        await this.writeLine(id, existing.orgUnitId, line, existing.requestedById, now);
      }

      const status: PermitStatus = lines.length ? "CLINICAL_REVIEW" : "APPROVED";
      const touched = await tx.db
        .update(schema.shutdownPermit)
        .set({
          ref,
          status,
          ilsm,
          clashes,
          submittedAt: now,
          approvedAt: status === "APPROVED" ? now : null,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.shutdownPermit.id, id))
        .returning({ id: schema.shutdownPermit.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");

      // RULE (§6.7): a clash warns and never blocks. The email goes out after
      // the permit is safely submitted, in the same transaction, so a warning
      // cannot exist for a submission that did not happen.
      if (clashes.length) await this.warnOfClashes(existing.orgUnitId, id, ref, clashes);
    } catch (error) {
      throw this.writeError(error);
    }
    return this.one(id, now);
  }

  /**
   * RULE (§6.5): «Permit is live only inside its window.» Outside it the
   * answer is 422 and the engineer moves the window or raises a new request —
   * a permit that can be started three days after it was meant to is a permit
   * the clinical approvers did not agree to.
   */
  private async activate(id: string, now: Date): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    if (existing.status !== "APPROVED") throw AppError.unprocessable("errors.permitNotApproved");
    if (!insideWindow(now, existing.plannedStart, existing.plannedEnd)) {
      throw AppError.unprocessable("errors.permitOutsideWindow");
    }

    try {
      const touched = await tx.db
        .update(schema.shutdownPermit)
        .set({ status: "ACTIVE", actualStart: now, updatedAt: sql`now()` })
        .where(eq(schema.shutdownPermit.id, id))
        .returning({ id: schema.shutdownPermit.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      throw this.writeError(error);
    }
    return this.one(id, now);
  }

  /**
   * RULE (§6.6): «No closeout, no permit closure.» Every box true, and the
   * clinical owner signs the acceptance.
   *
   * The signature is the caller's, stamped here — `clinicalAcceptanceById` is
   * never read out of the body, because a signature a client can type is a
   * signature nobody gave. So whoever closes the permit has to hold
   * WARD_MANAGER, NURSING or INFECTION_CONTROL over one of the affected
   * areas; anybody else is refused with `errors.permitAcceptanceNotYours`,
   * including the engineer who raised it and including an administrator.
   */
  private async close(id: string, input: PermitTransition, now: Date): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    if (existing.status !== "ACTIVE" && existing.status !== "BREACH") {
      throw AppError.unprocessable("errors.permitNotActive");
    }
    if (!input.closeout) throw AppError.unprocessable("errors.permitCloseoutRequired");
    if (!checklistComplete(input.closeout)) {
      throw AppError.unprocessable("errors.permitCloseoutIncomplete");
    }

    const caller = await callerUserId();
    const areas = await this.areasOf(id);
    const accepted = await this.holdsAcceptanceRole(
      caller,
      existing.orgUnitId,
      areas.map((area) => area.areaId),
    );
    if (!accepted) throw AppError.forbidden("errors.permitAcceptanceNotYours");

    const name = await this.displayName(caller);
    const closeout = {
      ...input.closeout,
      clinicalAcceptanceById: caller,
      clinicalAcceptanceByName: name,
      clinicalAcceptanceAt: now.toISOString(),
    };

    try {
      const touched = await tx.db
        .update(schema.shutdownPermit)
        .set({
          status: "CLOSED",
          closeout,
          actualEnd: now,
          closedBy: caller,
          closedAt: now,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.shutdownPermit.id, id))
        .returning({ id: schema.shutdownPermit.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      throw this.writeError(error);
    }
    return this.one(id, now);
  }

  /** A rejection is a decision, so it carries a reason, and it is final. */
  private async reject(id: string, input: PermitTransition, now: Date): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    const rejectable: PermitStatus[] = ["SUBMITTED", "CLINICAL_REVIEW", "APPROVED"];
    if (!rejectable.includes(existing.status)) {
      throw AppError.unprocessable("errors.permitNotRejectable");
    }
    if (!input.commentEl || !input.commentEl.trim()) {
      throw AppError.unprocessable("errors.permitCommentRequired");
    }

    try {
      const touched = await tx.db
        .update(schema.shutdownPermit)
        .set({
          status: "REJECTED",
          // The reason lives on the record where people read it, and in the
          // audit trail (R42) where it cannot be edited.
          descriptionEl: existing.descriptionEl,
          contingencyPlanEl: existing.contingencyPlanEl,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.shutdownPermit.id, id))
        .returning({ id: schema.shutdownPermit.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");

      await tx.db
        .update(schema.permitApproval)
        .set({ decision: "REJECTED", commentEl: input.commentEl, decidedAt: now, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.permitApproval.permitId, id),
            eq(schema.permitApproval.decision, "PENDING"),
          ),
        );
    } catch (error) {
      throw this.writeError(error);
    }
    return this.one(id, now);
  }

  // -------------------------------------------------------- approvals --

  /**
   * One approver's decision on one line (§6.4, UI S14).
   *
   * RULE: only the person the line resolved to may decide it, or an
   * administrator — a line nobody could be found for has to be unblockable,
   * and a decision taken by somebody else is recorded as theirs, with their
   * name, in the audit trail.
   *
   * Then the permit follows the route:
   *   every line APPROVED → APPROVED, stamped and audited (§6.4);
   *   any line RETURNED   → back to DRAFT with the comment kept and the
   *                         other lines reset, because the request is going
   *                         to change and their answers were about the old
   *                         one (UI S14 «Επιστροφή με σχόλια»);
   *   any line REJECTED   → REJECTED, which is final.
   */
  async decide(
    id: string,
    approvalId: string,
    input: ApprovalDecisionWrite,
    now: Date,
  ): Promise<ShutdownPermit> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    if (existing.status !== "CLINICAL_REVIEW") {
      throw AppError.unprocessable("errors.permitNotInReview");
    }
    if (!UUID.test(approvalId)) throw AppError.notFound("errors.permitApprovalNotFound");

    const lines = await tx.db
      .select()
      .from(schema.permitApproval)
      .where(
        and(eq(schema.permitApproval.id, approvalId), eq(schema.permitApproval.permitId, id)),
      )
      .limit(1);
    if (!lines.length) throw AppError.notFound("errors.permitApprovalNotFound");
    const line = lines[0];
    if (line.decision !== "PENDING") throw AppError.unprocessable("errors.permitAlreadyDecided");

    const caller = await callerUserId();
    // RULE (ADR-0015's segregation principle, applied to permits, ADR-0026
    // Errata): whoever requested the permit never decides one of its own
    // lines — not even an administrator standing in for a missing approver.
    // The body is fine and the rule is fine; it is who is asking that makes
    // it wrong, which is what 409 says and 403 does not.
    if (existing.requestedById === caller) {
      throw AppError.conflict("errors.permitSelfApproval");
    }
    const isAdmin = tx.context.roles.includes("admin");
    if (!isAdmin && line.approverId !== caller) {
      throw AppError.forbidden("errors.permitDecisionNotYours");
    }
    if (input.decision !== "APPROVED" && !input.commentEl?.trim()) {
      throw AppError.unprocessable("errors.permitCommentRequired");
    }

    try {
      await tx.db
        .update(schema.permitApproval)
        .set({
          decision: input.decision,
          commentEl: input.commentEl,
          decidedAt: now,
          // An administrator deciding on somebody's behalf is recorded as the
          // person who decided, not as the person who was asked.
          approverId: line.approverId ?? caller,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.permitApproval.id, approvalId));

      if (input.decision === "REJECTED") {
        await tx.db
          .update(schema.shutdownPermit)
          .set({ status: "REJECTED", updatedAt: sql`now()` })
          .where(eq(schema.shutdownPermit.id, id));
        await tx.db
          .update(schema.permitApproval)
          .set({
            decision: "REJECTED",
            commentEl: input.commentEl,
            decidedAt: now,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.permitApproval.permitId, id),
              eq(schema.permitApproval.decision, "PENDING"),
            ),
          );
      } else if (input.decision === "RETURNED") {
        await tx.db
          .update(schema.permitApproval)
          .set({ decision: "PENDING", commentEl: null, decidedAt: null, updatedAt: sql`now()` })
          .where(
            and(
              eq(schema.permitApproval.permitId, id),
              ne(schema.permitApproval.id, approvalId),
            ),
          );
        await tx.db
          .update(schema.shutdownPermit)
          .set({ status: "DRAFT", submittedAt: null, approvedAt: null, updatedAt: sql`now()` })
          .where(eq(schema.shutdownPermit.id, id));
      } else {
        const [{ pending }] = await tx.db
          .select({ pending: sql<number>`count(*)::int` })
          .from(schema.permitApproval)
          .where(
            and(
              eq(schema.permitApproval.permitId, id),
              eq(schema.permitApproval.decision, "PENDING"),
            ),
          );
        if (pending === 0) {
          await tx.db
            .update(schema.shutdownPermit)
            .set({ status: "APPROVED", approvedAt: now, updatedAt: sql`now()` })
            .where(eq(schema.shutdownPermit.id, id));
        }
      }
    } catch (error) {
      throw this.writeError(error);
    }
    return this.one(id, now);
  }

  // ------------------------------------------------------------ helpers --

  /**
   * R42 — the permit's own history: the permit row and every approval line
   * that ever belonged to it, newest first. Lines are matched through the
   * audit images rather than the current table, so a line a re-submission
   * deleted still shows in the trail it left (0002's pattern, for projects).
   *
   * There is no permission check here. `row()` first: a permit the caller may
   * not read does not exist for them, and the audit policy of migration 0015
   * is what decides the rest.
   */
  async auditOf(permitId: string): Promise<AuditEntry[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.row(permitId);

    const rows = await tx.db
      .select({
        id: schema.auditLog.id,
        actorId: schema.auditLog.actorId,
        actorName: sql<string | null>`ecapital.user_display_name_by_subject(${schema.auditLog.actorId})`,
        entityType: schema.auditLog.entityType,
        action: schema.auditLog.action,
        before: schema.auditLog.before,
        after: schema.auditLog.after,
        at: schema.auditLog.at,
      })
      .from(schema.auditLog)
      .where(
        sql`(${schema.auditLog.entityType} = 'shutdown_permit'
             and ${schema.auditLog.entityId} = ${permitId})
            or (${schema.auditLog.entityType} in ('permit_approval', 'shutdown_permit_area')
                and coalesce(${schema.auditLog.after} ->> 'permit_id',
                             ${schema.auditLog.before} ->> 'permit_id') = ${permitId})`,
      )
      .orderBy(desc(schema.auditLog.id))
      .limit(AUDIT_LINES);
    return rows.map((row) => toPermitAuditEntry(row as unknown as PermitAuditRow));
  }

  /** R24: does this project have a permit that is not settled yet (§6.6)? */
  async openPermitOn(projectId: string): Promise<{ ref: string | null } | null> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ ref: schema.shutdownPermit.ref })
      .from(schema.shutdownPermit)
      .where(
        and(
          eq(schema.shutdownPermit.projectId, projectId),
          inArray(schema.shutdownPermit.status, [
            "SUBMITTED",
            "CLINICAL_REVIEW",
            "APPROVED",
            "ACTIVE",
            "BREACH",
          ]),
        ),
      )
      .orderBy(asc(schema.shutdownPermit.ref))
      .limit(1);
    return rows[0] ?? null;
  }

  async row(id: string): Promise<PermitRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.permitNotFound");
    const rows = await tx.db
      .select({
        id: schema.shutdownPermit.id,
        ref: schema.shutdownPermit.ref,
        orgUnitId: schema.shutdownPermit.orgUnitId,
        projectId: schema.shutdownPermit.projectId,
        contractId: schema.shutdownPermit.contractId,
        titleEl: schema.shutdownPermit.titleEl,
        descriptionEl: schema.shutdownPermit.descriptionEl,
        workKind: schema.shutdownPermit.workKind,
        systems: schema.shutdownPermit.systems,
        plannedStart: schema.shutdownPermit.plannedStart,
        plannedEnd: schema.shutdownPermit.plannedEnd,
        actualStart: schema.shutdownPermit.actualStart,
        actualEnd: schema.shutdownPermit.actualEnd,
        icra: schema.shutdownPermit.icra,
        surrounding: schema.shutdownPermit.surrounding,
        ilsm: schema.shutdownPermit.ilsm,
        contingencyPlanEl: schema.shutdownPermit.contingencyPlanEl,
        status: schema.shutdownPermit.status,
        windowProvisional: schema.shutdownPermit.windowProvisional,
        closeout: schema.shutdownPermit.closeout,
        clashes: schema.shutdownPermit.clashes,
        requestedById: schema.shutdownPermit.requestedBy,
        requestedByName: sql<string | null>`ecapital.user_display_name(${schema.shutdownPermit.requestedBy})`,
        requestedAt: schema.shutdownPermit.requestedAt,
        submittedAt: schema.shutdownPermit.submittedAt,
        approvedAt: schema.shutdownPermit.approvedAt,
        closedById: schema.shutdownPermit.closedBy,
        closedAt: schema.shutdownPermit.closedAt,
        breachedAt: schema.shutdownPermit.breachedAt,
        createdAt: schema.shutdownPermit.createdAt,
        updatedAt: schema.shutdownPermit.updatedAt,
      })
      .from(schema.shutdownPermit)
      .where(eq(schema.shutdownPermit.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.permitNotFound");
    return rows[0] as unknown as PermitRow;
  }

  async areasOf(permitId: string): Promise<AffectedArea[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        areaId: schema.shutdownPermitArea.areaId,
        impact: schema.shutdownPermitArea.impact,
        viaSystem: schema.shutdownPermitArea.viaSystem,
        code: schema.area.code,
        nameEl: schema.area.nameEl,
        areaType: schema.area.areaType,
        patientRiskGroup: schema.area.patientRiskGroup,
        floorCode: schema.floor.code,
        buildingCode: schema.building.code,
      })
      .from(schema.shutdownPermitArea)
      .innerJoin(schema.area, eq(schema.area.id, schema.shutdownPermitArea.areaId))
      .innerJoin(schema.floor, eq(schema.floor.id, schema.area.floorId))
      .innerJoin(schema.building, eq(schema.building.id, schema.floor.buildingId))
      .where(eq(schema.shutdownPermitArea.permitId, permitId))
      // Direct first, then by code, so the route and the printed permit read
      // in the order the engineer thought about them.
      .orderBy(asc(schema.shutdownPermitArea.impact), asc(schema.area.code));
    return rows.map((row) => AffectedArea.parse(row));
  }

  async approvalsOf(permitId: string, now: Date): Promise<PermitApproval[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        id: schema.permitApproval.id,
        permitId: schema.permitApproval.permitId,
        role: schema.permitApproval.role,
        reason: schema.permitApproval.reason,
        areaId: schema.permitApproval.areaId,
        areaNameEl: sql<string | null>`(select a.name_el from ecapital.area a where a.id = ${schema.permitApproval.areaId})`,
        approverId: schema.permitApproval.approverId,
        approverName: sql<string | null>`ecapital.user_display_name(${schema.permitApproval.approverId})`,
        decision: schema.permitApproval.decision,
        commentEl: schema.permitApproval.commentEl,
        decidedAt: schema.permitApproval.decidedAt,
        dueAt: schema.permitApproval.dueAt,
        slaHours: schema.permitApproval.slaHours,
      })
      .from(schema.permitApproval)
      .where(eq(schema.permitApproval.permitId, permitId))
      .orderBy(asc(schema.permitApproval.createdAt), asc(schema.permitApproval.id));
    return rows.map((row) => toApproval(row as ApprovalRow, now));
  }

  /** Every area of the permit has to be in one unit; that unit is the permit's. */
  private async unitOfAreas(areaIds: string[]): Promise<string> {
    const facts = await this.feeds.areaFacts(null, areaIds);
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const ids = areaIds.filter((id) => UUID.test(id));
    if (!ids.length || facts.size !== new Set(ids).size) {
      throw AppError.notFound("errors.permitAreaNotFound");
    }
    const rows = await tx.db
      .selectDistinct({ orgUnitId: schema.area.orgUnitId })
      .from(schema.area)
      .where(inArray(schema.area.id, ids));
    if (rows.length !== 1) throw AppError.unprocessable("errors.permitAreasAcrossUnits");
    return rows[0].orgUnitId;
  }

  /**
   * The window, or a placeholder for a wizard that has not reached step 3.
   *
   * The placeholder is an hour from now and it is flagged, so nothing
   * downstream mistakes it for a decision somebody took: the submission
   * refuses it and so does the CHECK constraint in migration 0016.
   */
  private window(
    start: string | undefined,
    end: string | undefined,
    now: Date,
  ): { start: Date; end: Date; provisional: boolean } {
    if (!start || !end) {
      return {
        start: now,
        end: new Date(now.getTime() + 3_600_000),
        provisional: true,
      };
    }
    const from = new Date(start);
    const to = new Date(end);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw AppError.badRequest("errors.permitNotValid");
    }
    if (to.getTime() <= from.getTime()) throw AppError.unprocessable("errors.permitWindowBackwards");
    return { start: from, end: to, provisional: false };
  }

  /**
   * The unit of a request that has no areas on it yet: the project's or the
   * contract's, and otherwise the caller's own — which is theirs alone when
   * they have one unit, and is refused as ambiguous when they have several,
   * because guessing which hospital a shutdown is in is not a guess to make.
   */
  private async unitOfCaller(
    projectId: string | null,
    contractId: string | null,
  ): Promise<string> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    if (projectId && UUID.test(projectId)) {
      const rows = await tx.db
        .select({ orgUnitId: schema.project.orgUnitId })
        .from(schema.project)
        .where(eq(schema.project.id, projectId))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.projectNotFound");
      return rows[0].orgUnitId;
    }
    if (contractId && UUID.test(contractId)) {
      const rows = await tx.db
        .select({ orgUnitId: schema.contract.orgUnitId })
        .from(schema.contract)
        .where(eq(schema.contract.id, contractId))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.contractNotFound");
      return rows[0].orgUnitId;
    }
    const units = tx.context.orgUnitIds.filter(Boolean);
    if (units.length !== 1) throw AppError.unprocessable("errors.permitUnitNeeded");
    return units[0];
  }

  private async writeAreas(
    permitId: string,
    orgUnitId: string,
    areas: AffectedArea[],
  ): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    for (const area of areas) {
      await tx.db.insert(schema.shutdownPermitArea).values({
        permitId,
        areaId: area.areaId,
        orgUnitId,
        impact: area.impact,
        viaSystem: area.viaSystem,
      });
    }
  }

  private async writeLine(
    permitId: string,
    orgUnitId: string,
    line: RouteLine,
    requestedById: string,
    now: Date,
  ): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const approverId = await this.resolveApprover(orgUnitId, line.role, line.areaId, requestedById);
    const sla = approvalSlaWindow(now);
    await tx.db.insert(schema.permitApproval).values({
      permitId,
      orgUnitId,
      role: line.role,
      reason: line.reason,
      areaId: line.areaId,
      approverId,
      decision: "PENDING",
      dueAt: sla.dueAt,
      slaHours: sla.hours,
    });
  }

  /**
   * Who this line is waiting on.
   *
   * A line about one area asks that area's owner. A unit-wide line asks the
   * person holding that capacity for the unit, and falls back to an area
   * owner holding it where there is no unit-wide appointment — an Infection
   * Control officer appointed over the theatres and not over the hospital is
   * still the Infection Control officer.
   *
   * No one found leaves the line unassigned and PENDING. That blocks the
   * permit, which is the strict reading and the right one: a route with a
   * signature missing is not an approved permit, and an administrator can
   * decide the line while somebody is appointed.
   *
   * RULE (ADR-0015's segregation principle, applied here per ADR-0026
   * Errata): the person who asked for the permit never resolves as the one
   * who signs off one of its own lines. When the natural answer is the
   * requester, another holder of the same role anywhere in the unit is
   * looked for instead (`anotherHolderInUnit`); when there is not one, the
   * line is left unassigned rather than handed back to its own requester —
   * an administrator can still decide it, subject to the same rule, once
   * somebody else is appointed.
   */
  private async resolveApprover(
    orgUnitId: string,
    role: ApprovalRole,
    areaId: string | null,
    requestedById: string,
  ): Promise<string | null> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    if (areaId) {
      const owners = await tx.db
        .select({ userId: schema.areaClinicalOwner.userId })
        .from(schema.areaClinicalOwner)
        .where(
          and(
            eq(schema.areaClinicalOwner.areaId, areaId),
            eq(schema.areaClinicalOwner.approvalRole, role),
          ),
        )
        .orderBy(asc(schema.areaClinicalOwner.createdAt))
        .limit(1);
      const candidate = owners[0]?.userId ?? null;
      if (candidate === null || candidate === requestedById) {
        return this.anotherHolderInUnit(orgUnitId, role, requestedById);
      }
      return candidate;
    }

    const unitWide = await tx.db
      .select({ userId: schema.unitApprover.userId })
      .from(schema.unitApprover)
      .where(
        and(
          eq(schema.unitApprover.orgUnitId, orgUnitId),
          eq(schema.unitApprover.approvalRole, role),
        ),
      )
      .orderBy(asc(schema.unitApprover.createdAt))
      .limit(1);
    if (unitWide.length && unitWide[0].userId !== requestedById) return unitWide[0].userId;

    const byArea = await tx.db
      .select({ userId: schema.areaClinicalOwner.userId })
      .from(schema.areaClinicalOwner)
      .where(
        and(
          eq(schema.areaClinicalOwner.orgUnitId, orgUnitId),
          eq(schema.areaClinicalOwner.approvalRole, role),
        ),
      )
      .orderBy(asc(schema.areaClinicalOwner.createdAt))
      .limit(1);
    if (byArea.length && byArea[0].userId !== requestedById) return byArea[0].userId;

    if (unitWide.length || byArea.length) {
      // The only holder(s) found are the requester themselves — look
      // further before giving up.
      return this.anotherHolderInUnit(orgUnitId, role, requestedById);
    }
    return null;
  }

  /**
   * Any other holder of `role` in the unit, unit-wide appointments first —
   * used only when the natural resolution above landed on the requester.
   */
  private async anotherHolderInUnit(
    orgUnitId: string,
    role: ApprovalRole,
    excludeUserId: string,
  ): Promise<string | null> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const unitWide = await tx.db
      .select({ userId: schema.unitApprover.userId })
      .from(schema.unitApprover)
      .where(
        and(
          eq(schema.unitApprover.orgUnitId, orgUnitId),
          eq(schema.unitApprover.approvalRole, role),
          ne(schema.unitApprover.userId, excludeUserId),
        ),
      )
      .orderBy(asc(schema.unitApprover.createdAt))
      .limit(1);
    if (unitWide.length) return unitWide[0].userId;

    const byArea = await tx.db
      .select({ userId: schema.areaClinicalOwner.userId })
      .from(schema.areaClinicalOwner)
      .where(
        and(
          eq(schema.areaClinicalOwner.orgUnitId, orgUnitId),
          eq(schema.areaClinicalOwner.approvalRole, role),
          ne(schema.areaClinicalOwner.userId, excludeUserId),
        ),
      )
      .orderBy(asc(schema.areaClinicalOwner.createdAt))
      .limit(1);
    return byArea[0]?.userId ?? null;
  }

  /** §6.6: is this person a clinical owner of one of these rooms, or of the unit? */
  private async holdsAcceptanceRole(
    userId: string,
    orgUnitId: string,
    areaIds: string[],
  ): Promise<boolean> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (areaIds.length) {
      const owned = await tx.db
        .select({ id: schema.areaClinicalOwner.id })
        .from(schema.areaClinicalOwner)
        .where(
          and(
            eq(schema.areaClinicalOwner.userId, userId),
            inArray(schema.areaClinicalOwner.areaId, areaIds),
            inArray(schema.areaClinicalOwner.approvalRole, ACCEPTANCE_ROLES),
          ),
        )
        .limit(1);
      if (owned.length) return true;
    }
    // NURSING and INFECTION_CONTROL answer for the whole hospital, so holding
    // one of them for the unit is holding it for every room in it.
    const unitWide = await tx.db
      .select({ id: schema.unitApprover.id })
      .from(schema.unitApprover)
      .where(
        and(
          eq(schema.unitApprover.userId, userId),
          eq(schema.unitApprover.orgUnitId, orgUnitId),
          inArray(schema.unitApprover.approvalRole, ["NURSING", "INFECTION_CONTROL"]),
        ),
      )
      .limit(1);
    return unitWide.length > 0;
  }

  private async displayName(userId: string): Promise<string> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({ name: sql<string | null>`ecapital.user_display_name(${userId}::uuid)` })
      .from(sql`(select 1) as one`);
    return row?.name ?? "";
  }

  /** §6.7, at submission, over everything in the unit that is still live. */
  private async clashesFor(
    permit: PermitRow,
    areas: AffectedArea[],
    _now: Date,
  ): Promise<Clash[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        id: schema.shutdownPermit.id,
        ref: schema.shutdownPermit.ref,
        orgUnitId: schema.shutdownPermit.orgUnitId,
        systems: schema.shutdownPermit.systems,
        start: schema.shutdownPermit.plannedStart,
        end: schema.shutdownPermit.plannedEnd,
      })
      .from(schema.shutdownPermit)
      .where(
        and(
          eq(schema.shutdownPermit.orgUnitId, permit.orgUnitId),
          ne(schema.shutdownPermit.id, permit.id),
          inArray(schema.shutdownPermit.status, LIVE_PERMIT_STATUSES),
          // Only the ones whose windows could possibly touch this one.
          lte(schema.shutdownPermit.plannedStart, permit.plannedEnd),
          gte(schema.shutdownPermit.plannedEnd, permit.plannedStart),
        ),
      );
    if (!rows.length) return [];

    const others = await tx.db
      .select({
        permitId: schema.shutdownPermitArea.permitId,
        areaId: schema.shutdownPermitArea.areaId,
        areaType: schema.area.areaType,
      })
      .from(schema.shutdownPermitArea)
      .innerJoin(schema.area, eq(schema.area.id, schema.shutdownPermitArea.areaId))
      .where(
        inArray(
          schema.shutdownPermitArea.permitId,
          rows.map((row) => row.id),
        ),
      );

    const candidates: ClashCandidate[] = rows.map((row) => {
      const mine = others.filter((o) => o.permitId === row.id);
      return {
        id: row.id,
        ref: row.ref,
        orgUnitId: row.orgUnitId,
        systems: row.systems,
        areaIds: mine.map((o) => o.areaId),
        areaTypes: mine.map((o) => o.areaType),
        start: row.start,
        end: row.end,
      };
    });

    return findClashes(
      {
        id: permit.id,
        ref: permit.ref,
        orgUnitId: permit.orgUnitId,
        systems: permit.systems,
        areaIds: areas.map((area) => area.areaId),
        areaTypes: areas.map((area) => area.areaType),
        start: permit.plannedStart,
        end: permit.plannedEnd,
      },
      candidates,
    );
  }

  /**
   * CAPEX-01 §7's pattern, reused: there is no SMTP server yet, so the row is
   * written and a sender picks it up when there is one (ADR-0021). Written by
   * `ecapital.queue_email` as the owner, because a warning that could only be
   * queued by somebody with a write grant would not be queued at all on a
   * read path.
   */
  private async warnOfClashes(
    orgUnitId: string,
    permitId: string,
    ref: string | null,
    clashes: Clash[],
  ): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const heads = await tx.db
      .select({ email: schema.appUser.email, name: schema.appUser.name })
      .from(schema.appUser)
      .innerJoin(schema.appUserRole, eq(schema.appUserRole.appUserId, schema.appUser.id))
      .innerJoin(schema.appUserOrgUnit, eq(schema.appUserOrgUnit.appUserId, schema.appUser.id))
      .where(
        and(
          eq(schema.appUserRole.role, "estates_head"),
          eq(schema.appUserOrgUnit.orgUnitId, orgUnitId),
          eq(schema.appUser.isActive, true),
        ),
      );

    const label = ref ?? permitId;
    const kinds = clashes.map((clash) => clash.kind).join(", ");
    for (const head of heads) {
      await tx.db.execute(sql`
        select ecapital.queue_email(
          ${orgUnitId}, ${head.email}, ${head.name},
          ${`Σύγκρουση διακοπών: ${label}`},
          ${`Shutdown clash: ${label}`},
          ${`Η άδεια εργασίας ${label} συμπίπτει με άλλη διακοπή στη μονάδα σας (${kinds}). Ελέγξτε το ημερολόγιο κλινικής διατάραξης.`},
          ${`Permit ${label} overlaps another shutdown in your unit (${kinds}). Check the clinical disruption calendar.`},
          'shutdown_permit', ${permitId})`);
    }
  }

  private writeError(error: unknown): never {
    if (error instanceof AppError) throw error;
    const state = sqlState(error);
    if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
    // The two triggers of migration 0015: an immutable reference and a permit
    // that has been closed or rejected. Reaching either means a service rule
    // was bypassed, which is what the trigger is there for.
    if (state === RESTRICT_VIOLATION) throw AppError.unprocessable("errors.permitSettled");
    if (state === CHECK_VIOLATION) throw AppError.unprocessable("errors.permitNotValid");
    throw error;
  }
}
