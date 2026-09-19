import { Injectable } from "@nestjs/common";
import {
  type Issue,
  type IssueWrite,
  type Milestone,
  type MilestoneWrite,
  type ProjectCreate,
  type ProjectDetail,
  type ProjectList,
  type ProjectListQuery,
  type ProjectPhaseChange,
  type ProjectUpdate,
  type Risk,
  type RiskWrite,
} from "@ecapital/shared";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { AppError } from "../common/errors";
import { INSUFFICIENT_PRIVILEGE, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import {
  type AuditRow,
  isNextPhase,
  money,
  phaseIndex,
  type ProjectRow,
  toAuditEntry,
  toSummary,
} from "./project-rows";

/**
 * RULE (ADR-0014, owner decision 19/09/2026): from this phase on, the
 * approved budget is finance's to change and nobody else's.
 */
const BUDGET_LOCKED_FROM = "APPROVED" as const;

/** The last audit lines a project page shows (the contract's `audit`). */
const AUDIT_LINES = 50;

@Injectable()
export class ProjectsService {
  /**
   * There is no permission check anywhere in this file and there is not meant
   * to be one (ADR-0010). A project in a unit the caller may not see does not
   * exist for them: the select returns nothing and the answer is 404, the
   * same one a misspelt id gets. A write they may not make is refused by the
   * policy — either the insert raises 42501 or the update touches no rows —
   * and that is what turns into 403.
   */

  async list(query: ProjectListQuery): Promise<ProjectList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const filters: SQL[] = [];
    if (query.unit.length) filters.push(inArray(schema.project.orgUnitId, query.unit));
    if (query.phase.length) filters.push(inArray(schema.project.phase, query.phase));
    if (query.category.length) filters.push(inArray(schema.project.category, query.category));
    if (query.rag.length) filters.push(inArray(schema.project.rag, query.rag));
    if (query.q.trim()) {
      // Both sides through ecapital.normalise, so «ΑΝΑΚΑΙΝΙΣΗ» finds
      // «Ανακαίνιση χειρουργείων»: one implementation of the folding, in the
      // database, backing the trigram index on the same expression.
      filters.push(
        sql`${schema.project.searchNorm} like '%' || ecapital.normalise(${query.q.trim()}) || '%'`,
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    const [{ total }] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.project)
      .where(where);

    const direction = query.dir === "asc" ? asc : desc;
    // A project with no planned finish sorts last whichever way the column is
    // pointing; it is missing information, not an early or a late date.
    const order: SQL =
      query.sort === "orgUnit"
        ? direction(schema.orgUnit.nameEl)
        : query.sort === "plannedFinish"
          ? sql`${schema.project.plannedFinish} ${sql.raw(query.dir)} nulls last`
          : direction(SORT_COLUMNS[query.sort]);

    const rows = await tx.db
      .select(PROJECT_COLUMNS)
      .from(schema.project)
      .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.project.orgUnitId))
      .where(where)
      // Second key so a page boundary is stable when the first key ties.
      .orderBy(order, asc(schema.project.code))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: rows.map((row) => toSummary(row as ProjectRow)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string): Promise<ProjectDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const project = await this.load(id);

    const unitRows = await tx.db
      .select({
        id: schema.orgUnit.id,
        nameEl: schema.orgUnit.nameEl,
        nameEn: schema.orgUnit.nameEn,
      })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, project.orgUnitId))
      .limit(1);
    const orgUnit = unitRows[0] ?? { id: project.orgUnitId, nameEl: "", nameEn: "" };

    const [names] = await tx.db
      .select({
        sponsorName: sql<string | null>`ecapital.user_display_name(${project.sponsorId})`,
        projectManagerName: sql<
          string | null
        >`ecapital.user_display_name(${project.projectManagerId})`,
      })
      .from(sql`(select 1) as one`);

    const [milestones, risks, issues, audit] = await Promise.all([
      this.milestonesOf(id),
      this.risksOf(id),
      this.issuesOf(id),
      this.auditOf(id),
    ]);

    return {
      ...toSummary(project),
      orgUnit,
      sponsorName: names?.sponsorName ?? null,
      projectManagerName: names?.projectManagerName ?? null,
      milestones,
      risks,
      issues,
      audit,
    };
  }

  /**
   * ADR-0014. The code is allocated inside this request's transaction, by the
   * same function the seed uses, so a rolled-back create gives its number
   * back to nobody and two engineers pressing the button together get two
   * different numbers.
   *
   * RULE (ADR-0014, owner decision 19/09/2026): once a project is APPROVED or
   * later, only `finance` may change `approvedBudget`; see `update` below.
   */
  async create(input: ProjectCreate): Promise<ProjectDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const year = new Date().getUTCFullYear();
    try {
      const [{ code }] = await tx.db
        .select({
          code: sql<string>`ecapital.allocate_project_code(${input.orgUnitId}, ${year})`,
        })
        .from(sql`(select 1) as one`);

      const [row] = await tx.db
        .insert(schema.project)
        .values({
          code,
          orgUnitId: input.orgUnitId,
          titleEl: input.titleEl,
          titleEn: input.titleEn ?? null,
          category: input.category,
          approvedBudget: String(input.approvedBudget),
          fundingSource: input.fundingSource,
          plannedStart: input.plannedStart,
          plannedFinish: input.plannedFinish,
          budgetYearFrom: input.budgetYearFrom ?? null,
          budgetYearTo: input.budgetYearTo ?? null,
          sapWbs: input.sapWbs,
          tenderReference: input.tenderReference,
          sponsorId: input.sponsorId ?? null,
          projectManagerId: input.projectManagerId ?? null,
          rag: "GREEN",
          ragReason: "",
        })
        .returning({ id: schema.project.id });

      return await this.detail(row.id);
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  /**
   * RULE (ADR-0014, owner decision 19/09/2026): once a project reaches
   * APPROVED, its approved budget is a finance figure. Only somebody with the
   * `finance` role may change it; everybody else is refused with
   * errors.budgetFinanceOnly, and an administrator is not exempt — the
   * segregation is the whole point of the rule. Before APPROVED it is an
   * ordinary field and anybody who may edit the project may edit it.
   *
   * The change itself goes through ecapital.set_approved_budget, which moves
   * that one column and checks the role itself, because the register's write
   * policy deliberately does not give the project to finance (ADR-0015). The
   * audit trigger records the before and the after as it does for any change.
   */
  async update(id: string, input: ProjectUpdate): Promise<ProjectDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const project = await this.load(id);

    const budget = input.approvedBudget;
    const changingBudget = budget !== undefined && budget !== money(project.approvedBudget);
    const needsFinance = changingBudget && phaseIndex(project.phase) >= phaseIndex(BUDGET_LOCKED_FROM);
    if (needsFinance && !(tx.context.roles ?? []).includes("finance")) {
      throw AppError.forbidden("errors.budgetFinanceOnly");
    }
    if (needsFinance) {
      const [{ done }] = await tx.db
        .select({
          done: sql<boolean>`ecapital.set_approved_budget(${id}::uuid, ${String(budget)}::numeric)`,
        })
        .from(sql`(select 1) as one`);
      if (!done) throw AppError.forbidden("errors.budgetFinanceOnly");
    }

    const values = pruned({
      titleEl: input.titleEl,
      titleEn: input.titleEn,
      category: input.category,
      approvedBudget:
        input.approvedBudget === undefined || needsFinance
          ? undefined
          : String(input.approvedBudget),
      fundingSource: input.fundingSource,
      plannedStart: input.plannedStart,
      plannedFinish: input.plannedFinish,
      budgetYearFrom: input.budgetYearFrom,
      budgetYearTo: input.budgetYearTo,
      sapWbs: input.sapWbs,
      tenderReference: input.tenderReference,
      sponsorId: input.sponsorId,
      projectManagerId: input.projectManagerId,
    });
    if (Object.keys(values).length === 0) return this.detail(id);

    const touched = await tx.db
      .update(schema.project)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(schema.project.id, id))
      .returning({ id: schema.project.id });
    if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");

    return this.detail(id);
  }

  /**
   * RULE (R04): a phase moves exactly one step forward along the nine, with a
   * reason. Backwards or skipping is refused with errors.phaseNotNext.
   *
   * RULE (R04): if the phase being left has a gate milestone with no actual
   * date, the move is refused with errors.gateOpen and the milestone is named
   * in the sentence. The gate is the approval; an unticked gate means the
   * approval has not happened.
   *
   * RULE (R04): an administrator may move a project backwards. Going back is
   * a decision somebody takes and records, not a correction of a typo, so it
   * is recorded exactly like any other move — same reason, same audit row —
   * and only an administrator may take it. Everyone else is refused with
   * errors.phaseNotNext, whichever direction they asked for.
   */
  async changePhase(id: string, input: ProjectPhaseChange): Promise<ProjectDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const project = await this.load(id);
    const isAdmin = (tx.context.roles ?? []).includes("admin");
    const forward = isNextPhase(project.phase, input.phase);
    const backward = phaseIndex(input.phase) < phaseIndex(project.phase);

    if (!forward && !(isAdmin && backward)) throw AppError.unprocessable("errors.phaseNotNext");

    if (forward) {
      const open = await tx.db
        .select({ titleEl: schema.milestone.titleEl })
        .from(schema.milestone)
        .where(
          and(
            eq(schema.milestone.projectId, id),
            eq(schema.milestone.isGate, true),
            sql`${schema.milestone.actualDate} is null`,
          ),
        )
        .orderBy(asc(schema.milestone.sortOrder))
        .limit(1);
      if (open.length) {
        throw AppError.unprocessable("errors.gateOpen", { milestone: open[0].titleEl });
      }
    }

    const touched = await tx.db
      .update(schema.project)
      .set({
        phase: input.phase,
        phaseReasonEl: input.reasonEl,
        phaseChangedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.project.id, id))
      .returning({ id: schema.project.id });
    if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");

    return this.detail(id);
  }

  // ------------------------------------------------------------ children --

  async addMilestone(projectId: string, input: MilestoneWrite): Promise<Milestone> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(projectId);

    try {
      const [row] = await tx.db
        .insert(schema.milestone)
        .values({
          projectId,
          // The trigger overwrites this from the project; it is here because
          // the column is NOT NULL.
          orgUnitId: "",
          titleEl: input.titleEl,
          baselineDate: input.baselineDate,
          forecastDate: input.forecastDate ?? null,
          actualDate: input.actualDate ?? null,
          isGate: input.isGate,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      return toMilestone(row);
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  /**
   * RULE (R06): baselineDate is the promise the project was approved on. It
   * is fixed at creation; a body that asks for a different one is refused
   * with errors.baselineFixed. Forecast and actual move as often as the work
   * does — that difference is the whole point of keeping all three.
   */
  async updateMilestone(
    projectId: string,
    milestoneId: string,
    input: MilestoneWrite,
  ): Promise<Milestone> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(projectId);

    const existing = await tx.db
      .select()
      .from(schema.milestone)
      .where(and(eq(schema.milestone.id, milestoneId), eq(schema.milestone.projectId, projectId)))
      .limit(1);
    if (!existing.length) throw AppError.notFound("errors.milestoneNotFound");
    if (existing[0].baselineDate !== input.baselineDate) {
      throw AppError.unprocessable("errors.baselineFixed", { baseline: existing[0].baselineDate });
    }

    const touched = await tx.db
      .update(schema.milestone)
      .set({
        titleEl: input.titleEl,
        forecastDate: input.forecastDate ?? null,
        actualDate: input.actualDate ?? null,
        isGate: input.isGate,
        sortOrder: input.sortOrder ?? existing[0].sortOrder,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.milestone.id, milestoneId))
      .returning();
    if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    return toMilestone(touched[0]);
  }

  async addRisk(projectId: string, input: RiskWrite): Promise<Risk> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(projectId);

    try {
      const [row] = await tx.db
        .insert(schema.risk)
        .values({
          projectId,
          orgUnitId: "",
          descriptionEl: input.descriptionEl,
          likelihood: input.likelihood,
          impact: input.impact,
          ownerId: input.ownerId ?? null,
          mitigationEl: input.mitigationEl ?? null,
          status: input.status ?? "OPEN",
        })
        .returning();
      return this.toRisk(row);
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  async updateRisk(projectId: string, riskId: string, input: RiskWrite): Promise<Risk> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(projectId);

    const existing = await tx.db
      .select({ id: schema.risk.id })
      .from(schema.risk)
      .where(and(eq(schema.risk.id, riskId), eq(schema.risk.projectId, projectId)))
      .limit(1);
    if (!existing.length) throw AppError.notFound("errors.riskNotFound");

    const touched = await tx.db
      .update(schema.risk)
      .set({
        descriptionEl: input.descriptionEl,
        likelihood: input.likelihood,
        impact: input.impact,
        ownerId: input.ownerId ?? null,
        mitigationEl: input.mitigationEl ?? null,
        status: input.status ?? "OPEN",
        updatedAt: sql`now()`,
      })
      .where(eq(schema.risk.id, riskId))
      .returning();
    if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    return this.toRisk(touched[0]);
  }

  /**
   * RULE (R07): `raisedBy` is the caller, always. The contract leaves it out
   * of IssueWrite for that reason — nobody raises an issue in somebody else's
   * name.
   */
  async addIssue(projectId: string, input: IssueWrite): Promise<Issue> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(projectId);

    const caller = await this.callerId();
    try {
      const [row] = await tx.db
        .insert(schema.issue)
        .values({
          projectId,
          orgUnitId: "",
          descriptionEl: input.descriptionEl,
          raisedBy: caller,
          dueDate: input.dueDate ?? null,
          status: input.status ?? "OPEN",
        })
        .returning();
      return this.toIssue(row);
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  async updateIssue(projectId: string, issueId: string, input: IssueWrite): Promise<Issue> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(projectId);

    const existing = await tx.db
      .select({ id: schema.issue.id })
      .from(schema.issue)
      .where(and(eq(schema.issue.id, issueId), eq(schema.issue.projectId, projectId)))
      .limit(1);
    if (!existing.length) throw AppError.notFound("errors.issueNotFound");

    const touched = await tx.db
      .update(schema.issue)
      .set({
        descriptionEl: input.descriptionEl,
        dueDate: input.dueDate ?? null,
        status: input.status ?? "OPEN",
        updatedAt: sql`now()`,
      })
      .where(eq(schema.issue.id, issueId))
      .returning();
    if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    return this.toIssue(touched[0]);
  }

  // ------------------------------------------------------------ internals --

  private async load(id: string): Promise<ProjectRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    // A malformed uuid is not a database error to leak; it is simply not a
    // project anybody has.
    if (!UUID.test(id)) throw AppError.notFound("errors.projectNotFound");

    const rows = await tx.db
      .select(PROJECT_COLUMNS)
      .from(schema.project)
      .where(eq(schema.project.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.projectNotFound");
    return rows[0] as ProjectRow;
  }

  private async callerId(): Promise<string> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(eq(schema.appUser.subject, tx.context.userId))
      .limit(1);
    // The token verified, so the subject is real; a missing row means the
    // seed and the directory have drifted, which is not the caller's fault.
    if (!rows.length) throw AppError.internal();
    return rows[0].id;
  }

  private async milestonesOf(projectId: string): Promise<Milestone[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.projectId, projectId))
      .orderBy(asc(schema.milestone.sortOrder), asc(schema.milestone.baselineDate));
    return rows.map(toMilestone);
  }

  private async risksOf(projectId: string): Promise<Risk[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        id: schema.risk.id,
        projectId: schema.risk.projectId,
        descriptionEl: schema.risk.descriptionEl,
        likelihood: schema.risk.likelihood,
        impact: schema.risk.impact,
        ownerId: schema.risk.ownerId,
        ownerName: sql<string | null>`ecapital.user_display_name(${schema.risk.ownerId})`,
        mitigationEl: schema.risk.mitigationEl,
        status: schema.risk.status,
      })
      .from(schema.risk)
      .where(eq(schema.risk.projectId, projectId))
      .orderBy(desc(schema.risk.likelihood), desc(schema.risk.impact));
    return rows.map((row) => ({ ...row, ownerName: row.ownerName ?? null }));
  }

  private async issuesOf(projectId: string): Promise<Issue[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        id: schema.issue.id,
        projectId: schema.issue.projectId,
        descriptionEl: schema.issue.descriptionEl,
        raisedById: schema.issue.raisedBy,
        raisedByName: sql<string | null>`ecapital.user_display_name(${schema.issue.raisedBy})`,
        dueDate: schema.issue.dueDate,
        status: schema.issue.status,
      })
      .from(schema.issue)
      .where(eq(schema.issue.projectId, projectId))
      .orderBy(asc(schema.issue.dueDate));
    return rows.map((row) => ({ ...row, raisedByName: row.raisedByName ?? "" }));
  }

  /**
   * R42. The project's own history: the project row and every milestone, risk
   * and issue that ever belonged to it, newest first. Children are matched
   * through the audit images rather than through the current tables, so a
   * deleted milestone still shows in the trail it left.
   */
  private async auditOf(projectId: string): Promise<ProjectDetail["audit"]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        id: schema.auditLog.id,
        actorId: schema.auditLog.actorId,
        actorName: sql<
          string | null
        >`ecapital.user_display_name_by_subject(${schema.auditLog.actorId})`,
        entityType: schema.auditLog.entityType,
        action: schema.auditLog.action,
        before: schema.auditLog.before,
        after: schema.auditLog.after,
        at: schema.auditLog.at,
      })
      .from(schema.auditLog)
      .where(
        sql`(${schema.auditLog.entityType} = 'project' and ${schema.auditLog.entityId} = ${projectId})
            or (${schema.auditLog.entityType} in ('milestone', 'risk', 'issue')
                and coalesce(${schema.auditLog.after} ->> 'project_id',
                             ${schema.auditLog.before} ->> 'project_id') = ${projectId})`,
      )
      .orderBy(desc(schema.auditLog.id))
      .limit(AUDIT_LINES);
    return rows.map((row) => toAuditEntry(row as unknown as AuditRow));
  }

  private toRisk(row: typeof schema.risk.$inferSelect): Risk {
    return {
      id: row.id,
      projectId: row.projectId,
      descriptionEl: row.descriptionEl,
      likelihood: row.likelihood,
      impact: row.impact,
      ownerId: row.ownerId,
      ownerName: null,
      mitigationEl: row.mitigationEl,
      status: row.status,
    };
  }

  private toIssue(row: typeof schema.issue.$inferSelect): Issue {
    return {
      id: row.id,
      projectId: row.projectId,
      descriptionEl: row.descriptionEl,
      raisedById: row.raisedBy,
      raisedByName: "",
      dueDate: row.dueDate,
      status: row.status,
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROJECT_COLUMNS = {
  id: schema.project.id,
  code: schema.project.code,
  orgUnitId: schema.project.orgUnitId,
  titleEl: schema.project.titleEl,
  titleEn: schema.project.titleEn,
  noteEl: schema.project.noteEl,
  category: schema.project.category,
  phase: schema.project.phase,
  approvedBudget: schema.project.approvedBudget,
  fundingSource: schema.project.fundingSource,
  plannedStart: schema.project.plannedStart,
  plannedFinish: schema.project.plannedFinish,
  forecastStart: schema.project.forecastStart,
  forecastFinish: schema.project.forecastFinish,
  actualStart: schema.project.actualStart,
  actualFinish: schema.project.actualFinish,
  budgetYearFrom: schema.project.budgetYearFrom,
  budgetYearTo: schema.project.budgetYearTo,
  rag: schema.project.rag,
  ragReason: schema.project.ragReason,
  sapWbs: schema.project.sapWbs,
  tenderReference: schema.project.tenderReference,
  budgetArticle: schema.project.budgetArticle,
  commitmentFlag: schema.project.commitmentFlag,
  commitmentNote: schema.project.commitmentNote,
  actionPlanRef: schema.project.actionPlanRef,
  inBudget2026: schema.project.inBudget2026,
  contractualCommitment: schema.project.contractualCommitment,
  internalAuditFile: schema.project.internalAuditFile,
  sourceRowRef: schema.project.sourceRowRef,
  sponsorId: schema.project.sponsorId,
  projectManagerId: schema.project.projectManagerId,
  createdAt: schema.project.createdAt,
  updatedAt: schema.project.updatedAt,
  /**
   * RULE (CAPEX-01 §7, R13): the commitment ledger — the sum of the current
   * value of the project's contracts, each of which is its own value plus its
   * approved variations. `sum` over no rows is null, which is exactly the
   * answer for a project with no contract: null, never zero.
   *
   * The subquery runs inside the caller's transaction, so it sums the
   * contracts the caller may read. Anyone who may read the project may read
   * its contracts — same unit, same policy — so the figure is the same for
   * everybody who can see it at all (ADR-0010).
   */
  committed: sql<
    string | null
  >`(select sum(c.current_value) from ecapital.contract c
      where c.project_id = ecapital.project.id)`,
};

/** ProjectSort → the column it orders by. `orgUnit` is handled separately. */
const SORT_COLUMNS = {
  titleEl: schema.project.titleEl,
  code: schema.project.code,
  orgUnit: schema.project.orgUnitId,
  phase: schema.project.phase,
  approvedBudget: schema.project.approvedBudget,
  plannedFinish: schema.project.plannedFinish,
  rag: schema.project.rag,
  updatedAt: schema.project.updatedAt,
} as const;

function toMilestone(row: typeof schema.milestone.$inferSelect): Milestone {
  return {
    id: row.id,
    projectId: row.projectId,
    titleEl: row.titleEl,
    baselineDate: row.baselineDate,
    forecastDate: row.forecastDate,
    actualDate: row.actualDate,
    isGate: row.isGate,
    sortOrder: row.sortOrder,
  };
}

/** Drop the keys the caller did not send, so a PATCH touches only what it names. */
function pruned<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
