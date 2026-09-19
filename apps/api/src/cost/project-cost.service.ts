/**
 * R13, R16, R17 — the four ledgers, the forecast and the cash-flow profile.
 *
 * CAPEX-01 §7: "Four independent ledgers per project and per contract. Never
 * collapse them into one number."
 *
 *   Approved   the budget lines of the latest vintage, by year.
 *   Committed  the contracts' current value, or the SAP purchase-order
 *              balance once ingestion is live — and the answer says which.
 *   Spent      the actual postings.
 *   Forecast   committed + pending variations at a weight + contingency.
 *
 * RULE (the convention the cost screens keep, and the reason this file is
 * full of nulls): a ledger with no source is null, never zero. A project
 * nobody has committed anything on has no commitment; saying €0 would read as
 * "we have committed nothing", which is a claim, and the system has not got
 * one to make.
 *
 * ADR-0010: no permission check in here. A project the caller may not see
 * answers 404 because the row policy filtered it out.
 */
import { Injectable } from "@nestjs/common";
import type {
  BudgetLineType,
  CashflowRow,
  CostCategoryRow,
  ForecastInputs,
  ProjectCost,
} from "@ecapital/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import { INSUFFICIENT_PRIVILEGE, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import {
  type BudgetLineList,
  type BudgetLinesWrite,
  type CashflowQuery,
  SYSTEM_VINTAGE,
} from "./cost-contracts";
import {
  DEFAULT_FORECAST_INPUTS,
  UNCATEGORISED,
  categoryOf,
  costToCompleteOf,
  forecastOf,
  money,
  round2,
  sortCategories,
  toCategoryRow,
} from "./cost-rows";
import { CostWarningsService } from "./cost-warnings.service";

interface Ledgers {
  approved: number;
  approvedByYear: Map<number, number>;
  committed: number | null;
  committedSource: ProjectCost["committedSource"];
  spent: number | null;
  pendingVariations: number;
  lastSapImportAt: string | null;
}

@Injectable()
export class ProjectCostService {
  constructor(private readonly warnings: CostWarningsService) {}

  /** R13 — everything S04 shows, warnings included. */
  async costOf(projectId: string): Promise<ProjectCost> {
    await this.loadProject(projectId);

    const [ledgers, inputs] = await Promise.all([
      this.ledgersOf(projectId),
      this.forecastInputsOf(projectId),
    ]);

    const forecast = forecastOf({
      committed: ledgers.committed,
      pendingVariations: ledgers.pendingVariations,
      inputs,
    });

    // R31 runs on read: opening this screen is how somebody finds out.
    await this.warnings.evaluate(projectId);

    return {
      projectId,
      ledgers: {
        approved: round2(ledgers.approved),
        committed: ledgers.committed,
        spent: ledgers.spent,
        forecast,
        costToComplete: costToCompleteOf(forecast, ledgers.spent),
      },
      committedSource: ledgers.committedSource,
      forecastInputs: inputs,
      categories: await this.categoriesOf(projectId, ledgers, inputs),
      warnings: await this.warnings.listFor(projectId),
      lastSapImportAt: ledgers.lastSapImportAt,
    };
  }

  /** R16: the two figures the engineer owns, and the note behind them. */
  async forecastInputsOf(projectId: string): Promise<ForecastInputs> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        contingency: schema.forecastInputs.contingency,
        pendingVariationWeight: schema.forecastInputs.pendingVariationWeight,
        contingencyNoteEl: schema.forecastInputs.contingencyNoteEl,
      })
      .from(schema.forecastInputs)
      .where(eq(schema.forecastInputs.projectId, projectId))
      .limit(1);
    if (!rows.length) return { ...DEFAULT_FORECAST_INPUTS };
    return {
      contingency: money(rows[0].contingency),
      pendingVariationWeight: money(rows[0].pendingVariationWeight),
      contingencyNoteEl: rows[0].contingencyNoteEl,
    };
  }

  async setForecastInputs(projectId: string, input: ForecastInputs): Promise<ProjectCost> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const project = await this.loadProject(projectId);

    try {
      await tx.db
        .insert(schema.forecastInputs)
        .values({
          projectId,
          orgUnitId: project.orgUnitId,
          contingency: String(input.contingency),
          pendingVariationWeight: String(input.pendingVariationWeight),
          contingencyNoteEl: input.contingencyNoteEl,
        })
        .onConflictDoUpdate({
          target: schema.forecastInputs.projectId,
          set: {
            contingency: String(input.contingency),
            pendingVariationWeight: String(input.pendingVariationWeight),
            contingencyNoteEl: input.contingencyNoteEl,
            updatedAt: sql`now()`,
          },
        });
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
    return this.costOf(projectId);
  }

  /** The approved budget by year and vintage, newest vintage first. */
  async budgetLines(projectId: string): Promise<BudgetLineList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.loadProject(projectId);

    const rows = await tx.db
      .select({
        id: schema.budgetLine.id,
        orgUnitId: schema.budgetLine.orgUnitId,
        projectId: schema.budgetLine.projectId,
        vintageId: schema.budgetLine.vintageId,
        lineType: schema.budgetLine.lineType,
        budgetYear: schema.budgetLine.budgetYear,
        category: schema.budgetLine.category,
        sapGl: schema.budgetLine.sapGl,
        amount: schema.budgetLine.amount,
      })
      .from(schema.budgetLine)
      .where(eq(schema.budgetLine.projectId, projectId))
      .orderBy(asc(schema.budgetLine.vintageId), asc(schema.budgetLine.budgetYear));

    return {
      items: rows.map((row) => ({
        id: row.id,
        orgUnitId: row.orgUnitId,
        projectId: row.projectId,
        vintageId: row.vintageId,
        lineType: row.lineType as BudgetLineType,
        budgetYear: row.budgetYear,
        category: row.category,
        sapGl: row.sapGl,
        amount: money(row.amount),
      })),
      total: rows.length,
      vintageId: SYSTEM_VINTAGE,
    };
  }

  /**
   * RULE (ADR-0014, owner decision 19/09/2026): after a project is approved,
   * the budget is finance's. The route says so and so does the row policy —
   * `ecapital.can_manage_budget_line` gives the table to finance and the
   * administrator and to nobody else, so a repair script cannot do what an
   * engineer cannot.
   *
   * The lines of one vintage are replaced whole, the way a bill of quantities
   * is: an annual profile is a document and not a list of rows people edit
   * one at a time. The imported vintages are left exactly as they were, so a
   * correction here never rewrites what the capex plan said.
   */
  async replaceBudgetLines(projectId: string, input: BudgetLinesWrite): Promise<BudgetLineList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const project = await this.loadProject(projectId);
    const vintageId = input.vintageId ?? SYSTEM_VINTAGE;

    const years = new Set(input.lines.map((line) => `${line.budgetYear}:${line.lineType}`));
    if (years.size !== input.lines.length) {
      throw AppError.unprocessable("errors.budgetYearRepeated");
    }

    try {
      await tx.db
        .delete(schema.budgetLine)
        .where(
          and(
            eq(schema.budgetLine.projectId, projectId),
            eq(schema.budgetLine.vintageId, vintageId),
          ),
        );
      if (input.lines.length) {
        await tx.db.insert(schema.budgetLine).values(
          input.lines.map((line) => ({
            orgUnitId: project.orgUnitId,
            projectId,
            vintageId,
            lineType: line.lineType,
            budgetYear: line.budgetYear,
            category: line.category,
            sapGl: line.sapGl,
            amount: String(line.amount),
          })),
        );
      }
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.budgetFinanceOnly");
      }
      throw error;
    }

    // R31: the line the commitment is measured against has just moved.
    await this.warnings.evaluate(projectId);
    return this.budgetLines(projectId);
  }

  /**
   * R17 — the cash-flow profile by month.
   *
   * RULE (R17): the plan is the year's budget line spread evenly over its
   * twelve months. Nobody at ΟΚΥπΥ profiles a capital budget by month, and
   * inventing an S-curve would be the system making up a forecast nobody
   * agreed. Twelfths are obviously a straight line, which is honest.
   *
   * The «after 2028» sentinel year 9999 (CAPEX-03 §2) has no months to spread
   * over and is left out of the profile; it is still in the approved total.
   */
  async cashflow(projectId: string, query: CashflowQuery): Promise<CashflowRow[]> {
    await this.loadProject(projectId);
    return this.cashflowFor(eq(schema.budgetLine.projectId, projectId), eq(schema.costTxn.projectId, projectId), query);
  }

  /** R17 — the same profile, summed over every project of one unit. */
  async unitCashflow(orgUnitId: string, query: CashflowQuery): Promise<CashflowRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const unit = await tx.db
      .select({ id: schema.orgUnit.id })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, orgUnitId))
      .limit(1);
    if (!unit.length) throw AppError.notFound("errors.unitNotFound");
    return this.cashflowFor(
      eq(schema.budgetLine.orgUnitId, orgUnitId),
      eq(schema.costTxn.orgUnitId, orgUnitId),
      query,
    );
  }

  private async cashflowFor(
    budgetWhere: ReturnType<typeof eq>,
    txnWhere: ReturnType<typeof eq>,
    query: CashflowQuery,
  ): Promise<CashflowRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const vintage = await this.latestVintage(budgetWhere);
    const planned = vintage
      ? await tx.db
          .select({
            year: schema.budgetLine.budgetYear,
            amount: sql<string>`sum(${schema.budgetLine.amount})`,
          })
          .from(schema.budgetLine)
          .where(
            and(
              budgetWhere,
              eq(schema.budgetLine.lineType, "BUDGET"),
              eq(schema.budgetLine.vintageId, vintage),
              sql`${schema.budgetLine.budgetYear} < 9999`,
            ),
          )
          .groupBy(schema.budgetLine.budgetYear)
      : [];

    const actual = await tx.db
      .select({
        period: sql<string>`to_char(${schema.costTxn.postingDate}, 'YYYY-MM')`,
        amount: sql<string>`sum(${schema.costTxn.amount})`,
      })
      .from(schema.costTxn)
      .where(
        and(
          txnWhere,
          eq(schema.costTxn.txnType, "ACTUAL"),
          sql`${schema.costTxn.postingDate} is not null`,
        ),
      )
      .groupBy(sql`to_char(${schema.costTxn.postingDate}, 'YYYY-MM')`);

    const plannedByMonth = new Map<string, number>();
    for (const line of planned) {
      const perMonth = money(line.amount) / 12;
      for (let month = 1; month <= 12; month += 1) {
        const period = `${line.year}-${String(month).padStart(2, "0")}`;
        plannedByMonth.set(period, round2((plannedByMonth.get(period) ?? 0) + perMonth));
      }
    }
    const actualByMonth = new Map<string, number>();
    for (const row of actual) actualByMonth.set(row.period, money(row.amount));

    const periods = [...plannedByMonth.keys(), ...actualByMonth.keys()].sort();
    const thisYear = new Date().getUTCFullYear();
    const from = query.from ?? periods[0] ?? `${thisYear}-01`;
    const to = query.to ?? periods[periods.length - 1] ?? `${thisYear}-12`;
    if (to < from) throw AppError.badRequest("errors.cashflowRangeNotValid");

    const rows: CashflowRow[] = [];
    let cumulativePlanned = 0;
    let cumulativeActual = 0;
    let sawPlanned = false;
    let sawActual = false;

    for (const period of monthsBetween(from, to)) {
      const monthPlanned = plannedByMonth.get(period);
      const monthActual = actualByMonth.get(period);
      if (monthPlanned !== undefined) {
        sawPlanned = true;
        cumulativePlanned = round2(cumulativePlanned + monthPlanned);
      }
      if (monthActual !== undefined) {
        sawActual = true;
        cumulativeActual = round2(cumulativeActual + monthActual);
      }
      rows.push({
        period,
        planned: monthPlanned === undefined ? null : round2(monthPlanned),
        actual: monthActual === undefined ? null : round2(monthActual),
        // The running total only exists once there is something to run.
        cumulativePlanned: sawPlanned ? cumulativePlanned : null,
        cumulativeActual: sawActual ? cumulativeActual : null,
      });
    }
    return rows;
  }

  // ------------------------------------------------------------ internals --

  /**
   * The vintage the approved figure is read from. Vintages sort by id —
   * «2025-prior», «2026-02» — and the system vintage, which is what somebody
   * typed in eCapital, sorts last on purpose: a correction made here
   * supersedes the revision it was made against (ADR-0021).
   */
  private async latestVintage(where: ReturnType<typeof eq>): Promise<string | null> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ vintageId: schema.budgetLine.vintageId })
      .from(schema.budgetLine)
      .where(and(where, eq(schema.budgetLine.lineType, "BUDGET")))
      .orderBy(
        sql`(${schema.budgetLine.vintageId} = ${SYSTEM_VINTAGE}) desc`,
        sql`${schema.budgetLine.vintageId} desc`,
      )
      .limit(1);
    return rows.length ? rows[0].vintageId : null;
  }

  private async ledgersOf(projectId: string): Promise<Ledgers> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const vintage = await this.latestVintage(eq(schema.budgetLine.projectId, projectId));
    const approvedRows = vintage
      ? await tx.db
          .select({
            year: schema.budgetLine.budgetYear,
            amount: sql<string>`sum(${schema.budgetLine.amount})`,
          })
          .from(schema.budgetLine)
          .where(
            and(
              eq(schema.budgetLine.projectId, projectId),
              eq(schema.budgetLine.lineType, "BUDGET"),
              eq(schema.budgetLine.vintageId, vintage),
            ),
          )
          .groupBy(schema.budgetLine.budgetYear)
      : [];

    const approvedByYear = new Map<number, number>();
    for (const row of approvedRows) approvedByYear.set(row.year, money(row.amount));
    const approved = round2([...approvedByYear.values()].reduce((sum, value) => sum + value, 0));

    const result = await tx.db.execute<{
      sap_commitment: string | null;
      contract_commitment: string | null;
      has_contracts: boolean;
      spent: string | null;
      has_actuals: boolean;
      pending_variations: string | null;
      last_sap_import: Date | null;
    }>(sql`
      select (select sum(t.amount) from ecapital.cost_txn t
               where t.project_id = ${projectId}::uuid and t.txn_type = 'COMMITMENT'
                 and t.source in ('SAP_EXTRACT', 'SAP_MCP'))::text as sap_commitment,
             (select sum(c.current_value) from ecapital.contract c
               where c.project_id = ${projectId}::uuid)::text as contract_commitment,
             exists (select 1 from ecapital.contract c
                      where c.project_id = ${projectId}::uuid) as has_contracts,
             (select sum(t.amount) from ecapital.cost_txn t
               where t.project_id = ${projectId}::uuid and t.txn_type = 'ACTUAL')::text as spent,
             exists (select 1 from ecapital.cost_txn t
                      where t.project_id = ${projectId}::uuid and t.txn_type = 'ACTUAL') as has_actuals,
             (select sum(v.value) from ecapital.variation v
               join ecapital.contract c on c.id = v.contract_id
              where c.project_id = ${projectId}::uuid and v.status = 'SUBMITTED')::text
               as pending_variations,
             (select max(b.imported_at) from ecapital.import_batch b
               join ecapital.cost_txn t on t.import_batch_id = b.id
              where t.project_id = ${projectId}::uuid and b.report is not null)
               as last_sap_import`);
    const row = result.rows[0];

    // RULE (CAPEX-01 §7): the commitment is the contract ledger until SAP
    // ingestion is live for this project, and the purchase-order balance
    // afterwards — and `committedSource` says which, so nobody mixes the two
    // without knowing.
    const sapCommitment = row?.sap_commitment ?? null;
    let committed: number | null = null;
    let committedSource: ProjectCost["committedSource"] = "NONE";
    if (sapCommitment !== null) {
      committed = money(sapCommitment);
      committedSource = "SAP_PO";
    } else if (row?.has_contracts) {
      committed = money(row.contract_commitment);
      committedSource = "CONTRACTS";
    }

    return {
      approved,
      approvedByYear,
      committed,
      committedSource,
      spent: row?.has_actuals ? money(row.spent) : null,
      pendingVariations: money(row?.pending_variations),
      lastSapImportAt: row?.last_sap_import ? new Date(row.last_sap_import).toISOString() : null,
    };
  }

  /**
   * S04's category table. The approved figure and the actuals carry a
   * category — a budget line has one, and a posting inherits the one on the
   * budget line it was matched to. A contract does not: CAPEX-01 §4 gives it
   * a type and a value and no cost category, so contract-sourced commitment
   * and everything the forecast adds to it land in «Χωρίς κατηγορία», which
   * is where money with no category belongs and is what makes the column
   * still add up to the headline ledger (ADR-0021).
   */
  private async categoriesOf(
    projectId: string,
    ledgers: Ledgers,
    inputs: ForecastInputs,
  ): Promise<CostCategoryRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const vintage = await this.latestVintage(eq(schema.budgetLine.projectId, projectId));
    const approvedRows = vintage
      ? await tx.db
          .select({
            category: schema.budgetLine.category,
            amount: sql<string>`sum(${schema.budgetLine.amount})`,
          })
          .from(schema.budgetLine)
          .where(
            and(
              eq(schema.budgetLine.projectId, projectId),
              eq(schema.budgetLine.lineType, "BUDGET"),
              eq(schema.budgetLine.vintageId, vintage),
            ),
          )
          .groupBy(schema.budgetLine.category)
      : [];

    const txnRows = await tx.db.execute<{
      category: string | null;
      txn_type: string;
      amount: string;
    }>(sql`
      select b.category, t.txn_type, sum(t.amount)::text as amount
        from ecapital.cost_txn t
        left join ecapital.budget_line b on b.id = t.budget_line_id
       where t.project_id = ${projectId}::uuid
       group by b.category, t.txn_type`);

    const approvedBy = new Map<string, number>();
    for (const row of approvedRows) {
      const key = categoryOf(row.category);
      approvedBy.set(key, round2((approvedBy.get(key) ?? 0) + money(row.amount)));
    }

    const spentBy = new Map<string, number>();
    const committedBy = new Map<string, number>();
    for (const row of txnRows.rows) {
      const key = categoryOf(row.category);
      const target = row.txn_type === "ACTUAL" ? spentBy : row.txn_type === "COMMITMENT" ? committedBy : null;
      if (!target) continue;
      target.set(key, round2((target.get(key) ?? 0) + money(row.amount)));
    }

    // The contract ledger has no category of its own; it belongs to the
    // bucket, together with the contingency and the weighted variations.
    if (ledgers.committedSource === "CONTRACTS" && ledgers.committed !== null) {
      committedBy.set(
        UNCATEGORISED,
        round2((committedBy.get(UNCATEGORISED) ?? 0) + ledgers.committed),
      );
    }
    const adders = round2(
      ledgers.pendingVariations * inputs.pendingVariationWeight + inputs.contingency,
    );

    const keys = new Set([...approvedBy.keys(), ...spentBy.keys(), ...committedBy.keys()]);
    if (adders !== 0) keys.add(UNCATEGORISED);

    const rows: CostCategoryRow[] = [];
    for (const key of keys) {
      const committed = committedBy.has(key) ? (committedBy.get(key) as number) : null;
      const extra = key === UNCATEGORISED ? adders : 0;
      const forecast =
        committed === null && extra === 0 ? null : round2((committed ?? 0) + extra);
      rows.push(
        toCategoryRow(key, {
          approved: approvedBy.has(key) ? (approvedBy.get(key) as number) : null,
          committed,
          spent: spentBy.has(key) ? (spentBy.get(key) as number) : null,
          forecast,
        }),
      );
    }
    return sortCategories(rows);
  }

  async loadProject(id: string): Promise<{
    id: string;
    code: string;
    titleEl: string;
    orgUnitId: string;
  }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.projectNotFound");
    const rows = await tx.db
      .select({
        id: schema.project.id,
        code: schema.project.code,
        titleEl: schema.project.titleEl,
        orgUnitId: schema.project.orgUnitId,
      })
      .from(schema.project)
      .where(eq(schema.project.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.projectNotFound");
    return rows[0];
  }
}

/** Every YYYY-MM from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const periods: string[] = [];
  let [year, month] = from.split("-").map(Number);
  const [endYear, endMonth] = to.split("-").map(Number);
  // A window nobody would ask for is still a window somebody could type.
  for (let guard = 0; guard < 1200; guard += 1) {
    if (year > endYear || (year === endYear && month > endMonth)) break;
    periods.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}
