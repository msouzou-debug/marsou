/**
 * ADR-0037 — a project's cash-flow plan: read, write, and the Excel round
 * trip.
 *
 * The plan is the project's own monthly schedule of planned payments. It is
 * not the budget: its total may differ from the approved budget, the answer
 * says by how much (`difference`, plan − approved), and nothing is blocked.
 * When a project has a plan, the cash flow reads «planned» from it; when it
 * has none, the budget spread over twelve months stays (ProjectCostService).
 *
 * ADR-0010: no permission check in here. The route asks for `budgetLines`
 * WRITE, and 0028's row policy says the same, so a project the caller may
 * not see answers 404 and a unit the caller may not write refuses the write.
 */
import { Injectable } from "@nestjs/common";
import type {
  CashflowPlan,
  CashflowPlanImportResult,
  CashflowPlanMonth,
  CashflowPlanWrite,
} from "@ecapital/shared";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import type { I18nService } from "../common/i18n.service";
import { INSUFFICIENT_PRIVILEGE, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { cashflowPlanWorkbook, parsePlanSheet, readPlanSheet, type TemplateMonth } from "./cashflow-plan";
import type { CashflowQuery } from "./cost-contracts";
import { money, round2 } from "./cost-rows";
import { ProjectCostService, monthsBetween } from "./project-cost.service";

/** The longest window a template is drawn for: fifty years of months. */
const MAX_TEMPLATE_MONTHS = 600;

@Injectable()
export class CashflowPlanService {
  constructor(private readonly cost: ProjectCostService) {}

  async planOf(projectId: string): Promise<CashflowPlan> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.cost.loadProject(projectId);

    const rows = await tx.db
      .select({
        period: schema.projectCashflowPlan.period,
        amount: schema.projectCashflowPlan.amount,
        note: schema.projectCashflowPlan.note,
      })
      .from(schema.projectCashflowPlan)
      .where(eq(schema.projectCashflowPlan.projectId, projectId))
      .orderBy(asc(schema.projectCashflowPlan.period));

    // Who touched the plan last, and when: the newest row carries both.
    const last = await tx.db
      .select({
        updatedAt: schema.projectCashflowPlan.updatedAt,
        name: schema.appUser.name,
      })
      .from(schema.projectCashflowPlan)
      .leftJoin(schema.appUser, eq(schema.appUser.id, schema.projectCashflowPlan.updatedBy))
      .where(eq(schema.projectCashflowPlan.projectId, projectId))
      .orderBy(desc(schema.projectCashflowPlan.updatedAt))
      .limit(1);

    const months: CashflowPlanMonth[] = rows.map((row) => ({
      period: row.period,
      amount: money(row.amount),
      note: row.note,
    }));
    const total = round2(months.reduce((sum, month) => sum + month.amount, 0));
    const approvedBudget = await this.cost.approvedOf(projectId);
    return {
      projectId,
      months,
      total,
      approvedBudget,
      difference: round2(total - approvedBudget),
      updatedAt: last[0] ? new Date(last[0].updatedAt).toISOString() : null,
      updatedByName: last[0]?.name ?? null,
    };
  }

  /**
   * `replace`: the months given become the whole plan; a month not in the
   * list is removed, and an empty list removes the plan. `upsert`: the months
   * given are written and the rest left alone. Either way a month whose
   * amount and note did not change is not touched, so the audit trail shows
   * what moved and nothing else (R42, 0004).
   */
  async write(projectId: string, input: CashflowPlanWrite): Promise<CashflowPlan> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const project = await this.cost.loadProject(projectId);

    const periods = input.months.map((month) => month.period);
    if (new Set(periods).size !== periods.length) {
      throw AppError.unprocessable("errors.cashflowPlanPeriodRepeated");
    }
    const caller = await callerUserId();

    try {
      if (input.mode === "replace") {
        await tx.db
          .delete(schema.projectCashflowPlan)
          .where(
            periods.length
              ? and(
                  eq(schema.projectCashflowPlan.projectId, projectId),
                  notInArray(schema.projectCashflowPlan.period, periods),
                )
              : eq(schema.projectCashflowPlan.projectId, projectId),
          );
      }
      if (input.months.length) {
        await tx.db
          .insert(schema.projectCashflowPlan)
          .values(
            input.months.map((month) => ({
              projectId,
              orgUnitId: project.orgUnitId,
              period: month.period,
              amount: String(round2(month.amount)),
              note: month.note?.trim() ? month.note.trim() : null,
              updatedBy: caller,
            })),
          )
          .onConflictDoUpdate({
            target: [schema.projectCashflowPlan.projectId, schema.projectCashflowPlan.period],
            set: {
              amount: sql`excluded.amount`,
              note: sql`excluded.note`,
              updatedBy: sql`excluded.updated_by`,
              updatedAt: sql`now()`,
            },
            setWhere: sql`(${schema.projectCashflowPlan.amount}, ${schema.projectCashflowPlan.note})
                          is distinct from (excluded.amount, excluded.note)`,
          });
      }
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.cashflowPlanFinanceOnly");
      }
      throw error;
    }
    return this.planOf(projectId);
  }

  /**
   * RULE (owner): all or nothing. Every problem comes back with the sheet's
   * row number and nothing is written; a clean file replaces the plan whole,
   * because the file is the plan.
   */
  async importPlan(projectId: string, bytes: Buffer): Promise<CashflowPlanImportResult> {
    await this.cost.loadProject(projectId);
    const rows = await readPlanSheet(bytes);
    if (!rows) throw AppError.badRequest("errors.cashflowPlanFileNotValid");
    const parsed = parsePlanSheet(rows);
    if (parsed.errors.length) {
      return { saved: false, errors: parsed.errors, plan: null };
    }
    const plan = await this.write(projectId, { mode: "replace", months: parsed.months });
    return { saved: true, errors: [], plan };
  }

  /**
   * The template: the months of the window asked for, or of the plan, or of
   * the budget years, each with what the cash flow plans for it today — the
   * plan's figure, or the budget's twelfth — so the file starts from what
   * the screen shows.
   */
  async template(
    projectId: string,
    query: CashflowQuery,
    i18n: I18nService,
  ): Promise<{ code: string; file: Buffer }> {
    const project = await this.cost.loadProject(projectId);
    const plan = await this.planOf(projectId);

    let from = query.from;
    let to = query.to;
    if (!from || !to) {
      const window = plan.months.length
        ? { from: plan.months[0].period, to: plan.months[plan.months.length - 1].period }
        : await this.budgetWindow(projectId);
      from = from ?? window.from;
      to = to ?? window.to;
    }
    if (to < from) throw AppError.badRequest("errors.cashflowRangeNotValid");
    const periods = monthsBetween(from, to).slice(0, MAX_TEMPLATE_MONTHS);

    const notes = new Map(plan.months.map((month) => [month.period, month.note]));
    const profile = await this.cost.cashflow(projectId, { from, to });
    const planned = new Map(profile.map((row) => [row.period, row.planned]));
    const months: TemplateMonth[] = periods.map((period) => ({
      period,
      amount: planned.get(period) ?? 0,
      note: notes.get(period) ?? null,
    }));

    const file = await cashflowPlanWorkbook(
      { code: project.code, titleEl: project.titleEl, approved: plan.approvedBudget, months },
      i18n,
    );
    return { code: project.code, file };
  }

  /** January of the first budget year to December of the last; else this year. */
  private async budgetWindow(projectId: string): Promise<{ from: string; to: string }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({
        first: sql<number | null>`min(${schema.budgetLine.budgetYear})`,
        last: sql<number | null>`max(${schema.budgetLine.budgetYear})`,
      })
      .from(schema.budgetLine)
      .where(
        and(
          eq(schema.budgetLine.projectId, projectId),
          eq(schema.budgetLine.lineType, "BUDGET"),
          sql`${schema.budgetLine.budgetYear} < 9999`,
        ),
      );
    const thisYear = new Date().getUTCFullYear();
    const first = row?.first ?? thisYear;
    const last = row?.last ?? first;
    return { from: `${first}-01`, to: `${last}-12` };
  }
}
