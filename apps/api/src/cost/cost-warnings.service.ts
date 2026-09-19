/**
 * R31 — the five warn-and-flag rules, and the one thing they all have in
 * common: none of them blocks anything.
 *
 * CAPEX-01 §1: "Budget control is warn-and-flag, never a hard block. Finance
 * decides on blocking later." CAPEX-01 §7 lists the five rules and says each
 * one "fires a flag on the project, an entry in the exceptions list and an
 * email to the head of estates". So a warning is a row, not an exception
 * thrown: a certificate that takes the contract over its value is still
 * saved, and the person saving it is told.
 *
 * They are evaluated on read — opening the cost screen is how somebody finds
 * out — and again on every write that can move one: an import commit, an
 * allocation, a variation approval, a payment-certificate transition and a
 * change to the budget lines. `ecapital.record_cost_warning` does the
 * writing, as the table owner, so that an auditor opening the same screen
 * does not get a 403 from a policy on a row they never asked to create
 * (ADR-0021).
 *
 * RULE (R31): dismissal survives, because it is a row. A rule that was
 * dismissed and then moved fires again as a new row beside the dismissed one,
 * which is how somebody who waved away «€40.000 over» hears about €900.000.
 */
import { Injectable } from "@nestjs/common";
import type { CostWarning, CostWarningKey } from "@ecapital/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import type { Locale } from "../common/i18n.service";
import { I18nService } from "../common/i18n.service";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { money, round2 } from "./cost-rows";

/** What a rule found, before it is said in two languages. */
export interface WarningFact {
  key: CostWarningKey;
  contractId: string | null;
  /** The figure the sentence is about — the excess, not the total. */
  amount: number | null;
  params: Record<string, string | number>;
}

interface Subject {
  projectId: string;
  projectTitleEl: string;
  orgUnitId: string;
  unitNameEl: string;
  unitNameEn: string;
}

@Injectable()
export class CostWarningsService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * Work out which of the five rules hold for this project right now, write
   * the ones that do and clear the ones that no longer do.
   *
   * Never throws on a project the caller cannot write: the warnings are
   * written by a SECURITY DEFINER function precisely so that a read-only
   * account can still see them.
   */
  async evaluate(projectId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const subject = await this.subjectOf(projectId);
    if (!subject) return;

    const facts = [
      ...(await this.commitmentOverYearBudget(subject)),
      ...(await this.forecastOverApproved(subject)),
      ...(await this.contractRules(subject)),
    ];

    const fired = new Set(facts.map((fact) => `${fact.key}:${fact.contractId ?? ""}`));

    for (const fact of facts) {
      await tx.db.execute(sql`
        select ecapital.record_cost_warning(
          ${projectId}::uuid,
          ${fact.contractId}::uuid,
          ${fact.key}::ecapital.cost_warning_key,
          ${fact.amount},
          ${this.sentence(fact, subject, "el")},
          ${this.sentence(fact, subject, "en")})`);
    }

    // Anything live that no rule produced this time has stopped holding: the
    // figure came back under the line, the variation was withdrawn, the
    // certificate was corrected. The row goes and the audit log keeps the
    // DELETE with its before-image, which is the record that it fired.
    const live = await tx.db
      .select({ key: schema.costWarning.key, contractId: schema.costWarning.contractId })
      .from(schema.costWarning)
      .where(
        and(eq(schema.costWarning.projectId, projectId), isNull(schema.costWarning.dismissedAt)),
      );
    for (const row of live) {
      if (fired.has(`${row.key}:${row.contractId ?? ""}`)) continue;
      await tx.db.execute(sql`
        select ecapital.clear_cost_warning(
          ${projectId}::uuid, ${row.contractId}::uuid, ${row.key}::ecapital.cost_warning_key)`);
    }
  }

  /** Every warning on the project, live ones first, newest first inside each. */
  async listFor(projectId: string): Promise<CostWarning[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        id: schema.costWarning.id,
        key: schema.costWarning.key,
        projectId: schema.costWarning.projectId,
        contractId: schema.costWarning.contractId,
        sentenceEl: schema.costWarning.sentenceEl,
        sentenceEn: schema.costWarning.sentenceEn,
        amount: schema.costWarning.amount,
        firedAt: schema.costWarning.firedAt,
        dismissedById: schema.costWarning.dismissedBy,
        dismissedByName: sql<
          string | null
        >`ecapital.user_display_name(${schema.costWarning.dismissedBy})`,
        dismissedAt: schema.costWarning.dismissedAt,
      })
      .from(schema.costWarning)
      .where(eq(schema.costWarning.projectId, projectId))
      .orderBy(desc(schema.costWarning.firedAt));

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      projectId: row.projectId,
      contractId: row.contractId,
      sentenceEl: row.sentenceEl,
      sentenceEn: row.sentenceEn,
      amount: row.amount === null ? null : money(row.amount),
      firedAt: row.firedAt.toISOString(),
      dismissedById: row.dismissedById,
      dismissedByName: row.dismissedByName,
      dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    }));
  }

  /**
   * RULE (R31): dismissing a warning is a decision with a name on it. It is
   * recorded in the row — which is what makes it survive the next page load —
   * and in the audit log, by the trigger, like every other mutation (R42).
   */
  async dismiss(projectId: string, warningId: string): Promise<CostWarning> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const caller = await callerUserId();

    const touched = await tx.db
      .update(schema.costWarning)
      .set({ dismissedBy: caller, dismissedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(schema.costWarning.id, warningId),
          eq(schema.costWarning.projectId, projectId),
          isNull(schema.costWarning.dismissedAt),
        ),
      )
      .returning({ id: schema.costWarning.id });

    if (!touched.length) {
      // Either it does not exist, it belongs to another project, somebody
      // dismissed it already, or the policy refused the write. The first
      // three are the same answer; the fourth is caught below.
      const existing = await tx.db
        .select({ id: schema.costWarning.id, dismissedAt: schema.costWarning.dismissedAt })
        .from(schema.costWarning)
        .where(
          and(eq(schema.costWarning.id, warningId), eq(schema.costWarning.projectId, projectId)),
        )
        .limit(1);
      if (!existing.length) throw AppError.notFound("errors.costWarningNotFound");
      if (existing[0].dismissedAt === null) throw AppError.forbidden("errors.readOnlyAccount");
    }

    const all = await this.listFor(projectId);
    const found = all.find((warning) => warning.id === warningId);
    if (!found) throw AppError.notFound("errors.costWarningNotFound");
    return found;
  }

  // ------------------------------------------------------------ the rules --

  private async subjectOf(projectId: string): Promise<Subject | null> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        projectId: schema.project.id,
        projectTitleEl: schema.project.titleEl,
        orgUnitId: schema.project.orgUnitId,
        unitNameEl: schema.orgUnit.nameEl,
        unitNameEn: schema.orgUnit.nameEn,
      })
      .from(schema.project)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.project.orgUnitId))
      .where(eq(schema.project.id, projectId))
      .limit(1);
    return rows.length ? rows[0] : null;
  }

  /**
   * RULE 1 (R31): a commitment above the year's approved budget line.
   *
   * The commitment of a year is what SAP holds open against it when an
   * extract has been imported, and otherwise the contracts that start in it —
   * a contract commits the organisation from the day it starts, whatever SAP
   * has caught up with. Only the worst year fires, so a five-year project
   * with a profile that is out by a thousand euro in each year does not
   * produce five identical sentences.
   */
  private async commitmentOverYearBudget(subject: Subject): Promise<WarningFact[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const budget = await tx.db
      .select({
        year: schema.budgetLine.budgetYear,
        amount: sql<string>`sum(${schema.budgetLine.amount})`,
      })
      .from(schema.budgetLine)
      .where(
        and(
          eq(schema.budgetLine.projectId, subject.projectId),
          eq(schema.budgetLine.lineType, "BUDGET"),
        ),
      )
      .groupBy(schema.budgetLine.budgetYear);
    if (!budget.length) return [];

    const sapRows = await tx.db
      .select({
        year: sql<number>`extract(year from ${schema.costTxn.postingDate})::int`,
        amount: sql<string>`sum(${schema.costTxn.amount})`,
      })
      .from(schema.costTxn)
      .where(
        and(
          eq(schema.costTxn.projectId, subject.projectId),
          eq(schema.costTxn.txnType, "COMMITMENT"),
          sql`${schema.costTxn.postingDate} is not null`,
        ),
      )
      .groupBy(sql`extract(year from ${schema.costTxn.postingDate})`);

    const byYear = new Map<number, number>();
    if (sapRows.length) {
      for (const row of sapRows) byYear.set(row.year, money(row.amount));
    } else {
      const contracts = await tx.db
        .select({
          year: sql<number>`extract(year from coalesce(${schema.contract.startDate}, ${schema.contract.awardDate}))::int`,
          amount: sql<string>`sum(${schema.contract.currentValue})`,
        })
        .from(schema.contract)
        .where(eq(schema.contract.projectId, subject.projectId))
        .groupBy(
          sql`extract(year from coalesce(${schema.contract.startDate}, ${schema.contract.awardDate}))`,
        );
      for (const row of contracts) byYear.set(row.year, money(row.amount));
    }

    let worst: { year: number; excess: number; committed: number; approved: number } | null = null;
    for (const line of budget) {
      const approved = money(line.amount);
      const committed = byYear.get(line.year) ?? 0;
      const excess = round2(committed - approved);
      if (excess <= 0) continue;
      if (!worst || excess > worst.excess) worst = { year: line.year, excess, committed, approved };
    }
    if (!worst) return [];

    return [
      {
        key: "commitmentOverYearBudget",
        contractId: null,
        amount: worst.excess,
        params: {
          year: worst.year === 9999 ? "9999" : String(worst.year),
          committed: worst.committed,
          approved: worst.approved,
        },
      },
    ];
  }

  /** RULE 2 (R31): the forecast final cost above the approved budget. */
  private async forecastOverApproved(subject: Subject): Promise<WarningFact[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const result = await tx.db.execute<{ approved: string | null; forecast: string | null }>(sql`
      with approved as (
        select coalesce(sum(b.amount), 0) as total
          from ecapital.budget_line b
         where b.project_id = ${subject.projectId}::uuid and b.line_type = 'BUDGET'),
      committed as (
        select case
                 when exists (select 1 from ecapital.cost_txn t
                               where t.project_id = ${subject.projectId}::uuid
                                 and t.txn_type = 'COMMITMENT'
                                 and t.source in ('SAP_EXTRACT', 'SAP_MCP'))
                 then (select coalesce(sum(t.amount), 0) from ecapital.cost_txn t
                        where t.project_id = ${subject.projectId}::uuid
                          and t.txn_type = 'COMMITMENT')
                 else (select coalesce(sum(c.current_value), 0) from ecapital.contract c
                        where c.project_id = ${subject.projectId}::uuid)
               end as total),
      pending as (
        select coalesce(sum(v.value), 0) as total
          from ecapital.variation v
          join ecapital.contract c on c.id = v.contract_id
         where c.project_id = ${subject.projectId}::uuid and v.status = 'SUBMITTED'),
      inputs as (
        select coalesce(f.contingency, 0) as contingency,
               coalesce(f.pending_variation_weight, 0.5) as weight
          from (select 1) one
          left join ecapital.forecast_inputs f on f.project_id = ${subject.projectId}::uuid)
      select (select total from approved)::text as approved,
             ((select total from committed)
              + (select total from pending) * (select weight from inputs)
              + (select contingency from inputs))::text as forecast`);
    const row = result.rows[0];

    const approved = money(row?.approved);
    const forecast = money(row?.forecast);
    if (approved <= 0) return [];
    const excess = round2(forecast - approved);
    if (excess <= 0) return [];
    return [
      {
        key: "forecastOverApproved",
        contractId: null,
        amount: excess,
        params: { forecast, approved },
      },
    ];
  }

  /**
   * RULES 3, 4 and 5 (R31), all per contract: cumulative variations above
   * 10% of the original value, a certificate that takes the cumulative
   * certified above the contract's current value, and retention released
   * before the defects-liability period has ended.
   */
  private async contractRules(subject: Subject): Promise<WarningFact[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const result = await tx.db.execute<{
      id: string;
      contract_no: string;
      original_value: string;
      current_value: string;
      approved_variations: string;
      certified: string;
      retention_released: boolean;
      dlp_end: string | null;
    }>(sql`
      select c.id,
             c.contract_no,
             c.original_value::text,
             c.current_value::text,
             coalesce((select sum(v.value) from ecapital.variation v
                        where v.contract_id = c.id and v.status = 'APPROVED'), 0)::text
               as approved_variations,
             coalesce((select max(pc.work_done_value + pc.materials_on_site)
                         from ecapital.payment_cert pc where pc.contract_id = c.id), 0)::text
               as certified,
             exists (select 1 from ecapital.payment_cert pc
                      where pc.contract_id = c.id and pc.retention_released)
               as retention_released,
             (coalesce(c.completion_date, c.start_date, c.award_date)
                + (c.extension_days || ' days')::interval
                + (c.defects_liability_months || ' months')::interval)::date::text as dlp_end
        from ecapital.contract c
       where c.project_id = ${subject.projectId}::uuid`);
    const rows = result.rows;

    const facts: WarningFact[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const row of rows) {
      const original = money(row.original_value);
      const approvedVariations = money(row.approved_variations);
      const limit = round2(original * 0.1);
      if (original > 0 && approvedVariations > limit) {
        facts.push({
          key: "variationsOverTenPct",
          contractId: row.id,
          amount: round2(approvedVariations - limit),
          params: {
            contract: row.contract_no,
            pct: round2((approvedVariations / original) * 100),
          },
        });
      }

      const certified = money(row.certified);
      const currentValue = money(row.current_value);
      if (certified > currentValue && currentValue > 0) {
        facts.push({
          key: "certifiedOverContract",
          contractId: row.id,
          amount: round2(certified - currentValue),
          params: { contract: row.contract_no, certified, value: currentValue },
        });
      }

      // RULE (R31): released early is a warning, not a refusal. The money has
      // already left; what the system can do is make sure somebody knows.
      if (row.retention_released && row.dlp_end !== null && today < row.dlp_end) {
        facts.push({
          key: "retentionBeforeDlpEnd",
          contractId: row.id,
          amount: null,
          params: { contract: row.contract_no, date: row.dlp_end },
        });
      }
    }
    return facts;
  }

  /**
   * The sentence, written twice. The system never machine-translates content
   * (CAPEX-01 §6.1), so both are authored in src/i18n; the figures are
   * formatted per language because «1.234.567 €» and «€1,234,567» are the
   * same number said two ways.
   */
  private sentence(fact: WarningFact, subject: Subject, locale: Locale): string {
    const params: Record<string, string> = {
      project: subject.projectTitleEl,
      unit: locale === "el" ? subject.unitNameEl : subject.unitNameEn,
    };
    if (fact.amount !== null) params.amount = formatEuro(fact.amount, locale);
    for (const [name, value] of Object.entries(fact.params)) {
      if (typeof value === "number") {
        params[name] = name === "pct" ? formatPct(value, locale) : formatEuro(value, locale);
      } else params[name] = value;
    }
    return this.i18n.translate(`costWarnings.${fact.key}`, locale, params);
  }
}

export function formatEuro(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "el" ? "el-GR" : "en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPct(value: number, locale: Locale): string {
  return `${new Intl.NumberFormat(locale === "el" ? "el-GR" : "en-GB", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}
