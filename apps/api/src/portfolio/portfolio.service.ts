import { Injectable } from "@nestjs/common";
import type {
  Exception,
  OrgUnit,
  PortfolioResponse,
  Rag,
  UnitRow,
} from "@ecapital/shared";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { I18nService } from "../common/i18n.service";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { money } from "../projects/project-rows";

/** UI instructions §5: the exceptions list shows at most eight. */
const MAX_EXCEPTIONS = 8;

/** RULE: a forecast this far past the baseline is what counts as slipping. */
const SLIP_DAYS = 30;

/** RULE: a slip this large is red rather than amber. */
const SERIOUS_SLIP_DAYS = 90;

@Injectable()
export class PortfolioService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * S01 Χαρτοφυλάκιο (R03), computed from the projects the caller may see.
   * There is no unit filter in any query below: row-level security is what
   * decides which projects and which units are in the sums, so an engineer at
   * Larnaca gets a portfolio of Larnaca and the board gets all eleven units
   * (ADR-0010).
   */
  async build(asOf: Date): Promise<PortfolioResponse> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const units = await tx.db
      .select({
        id: schema.orgUnit.id,
        code: schema.orgUnit.code,
        nameEl: schema.orgUnit.nameEl,
        nameEn: schema.orgUnit.nameEn,
        type: schema.orgUnit.type,
        directorate: schema.orgUnit.directorate,
        costCentre: schema.orgUnit.costCentre,
        timezone: schema.orgUnit.timezone,
      })
      .from(schema.orgUnit)
      .orderBy(asc(schema.orgUnit.nameEl));

    const projects = await tx.db
      .select({
        id: schema.project.id,
        orgUnitId: schema.project.orgUnitId,
        approvedBudget: schema.project.approvedBudget,
        rag: schema.project.rag,
      })
      .from(schema.project);

    const approved = projects.reduce((sum, p) => sum + money(p.approvedBudget), 0);

    const rows: UnitRow[] = units
      .map((unit) => this.unitRow(unit as OrgUnit, projects))
      // UI instructions §5: default sort, approved budget descending.
      .sort((a, b) => b.approved - a.approved);

    return {
      kpis: {
        approved,
        // RULE (CAPEX-01 §7): a ledger the system does not know yet is null,
        // never zero. Committed, spent and forecast arrive with the SAP
        // ingestion in M2 (R14, R16); until then the tiles show «—».
        committed: null,
        spent: null,
        forecast: null,
        yearElapsedPct: yearElapsedPct(asOf),
      },
      units: rows,
      exceptions: await this.exceptions(asOf, units as OrgUnit[]),
      asOf: asOf.toISOString(),
    };
  }

  private unitRow(
    unit: OrgUnit,
    projects: { orgUnitId: string; approvedBudget: string | number; rag: Rag }[],
  ): UnitRow {
    const mine = projects.filter((p) => p.orgUnitId === unit.id);
    const approved = mine.reduce((sum, p) => sum + money(p.approvedBudget), 0);
    const rag = { green: 0, amber: 0, red: 0 };
    for (const project of mine) {
      if (project.rag === "GREEN") rag.green += 1;
      else if (project.rag === "AMBER") rag.amber += 1;
      else rag.red += 1;
    }
    return {
      orgUnit: unit,
      projectCount: mine.length,
      approved,
      // RULE (CAPEX-01 §7): null, never zero, until the SAP ingestion lands
      // (M2, R14) — `UnitRow.spent` is nullable in packages/shared for
      // exactly this.
      spent: null,
      sparkline: {
        // Plan is the approved budget spread evenly over the twelve months,
        // cumulative: a straight ramp is an honest picture of "we have a
        // budget and no profile yet". Spend stays flat zero — this is a
        // shape (there is nothing to plot yet), not a figure, so it does not
        // carry the same "null, never zero" rule the ledgers above do; a
        // sparkline has no way to draw "unknown" as a line. Both become real
        // in M2.
        plan: linearRamp(approved),
        spend: Array.from({ length: 12 }, () => 0),
      },
      rag,
    };
  }

  /**
   * "Χρειάζονται προσοχή" — at most eight sentences, in both languages,
   * naming the unit and linking to the project (UI instructions §5).
   *
   * RULE: three things earn a line in M1, and all three are facts the
   * register already knows — none of them needs the cost ledgers, which is
   * why the portfolio has something to say before SAP ingestion exists.
   *   1. a milestone forecast more than 30 days past its baseline (R06);
   *   2. a project with no planned start or no planned finish (CAPEX-03 V06
   *      leaves those blank on import, and a project nobody has dated is a
   *      project nobody is running);
   *   3. a project IN_PROGRESS whose planned finish is already behind us.
   * The RAG rule the cost screens use is deliberately not repeated here: in
   * M1 `project.rag` is stored, not derived (CAPEX-01 §7 derives it from the
   * four ledgers, and three of them are still unknown).
   */
  private async exceptions(asOf: Date, units: OrgUnit[]): Promise<Exception[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const byId = new Map(units.map((u) => [u.id, u]));
    const today = asOf.toISOString().slice(0, 10);

    const slipped = await tx.db
      .select({
        milestoneId: schema.milestone.id,
        milestoneTitle: schema.milestone.titleEl,
        days: sql<number>`(${schema.milestone.forecastDate} - ${schema.milestone.baselineDate})::int`,
        projectId: schema.project.id,
        projectTitle: schema.project.titleEl,
        orgUnitId: schema.project.orgUnitId,
      })
      .from(schema.milestone)
      .innerJoin(schema.project, eq(schema.project.id, schema.milestone.projectId))
      .where(
        sql`${schema.milestone.actualDate} is null
            and ${schema.milestone.forecastDate} is not null
            and ${schema.milestone.forecastDate} - ${schema.milestone.baselineDate} > ${SLIP_DAYS}`,
      );

    const undated = await tx.db
      .select({
        projectId: schema.project.id,
        projectTitle: schema.project.titleEl,
        orgUnitId: schema.project.orgUnitId,
      })
      .from(schema.project)
      .where(or(isNull(schema.project.plannedStart), isNull(schema.project.plannedFinish)));

    const overdue = await tx.db
      .select({
        projectId: schema.project.id,
        projectTitle: schema.project.titleEl,
        orgUnitId: schema.project.orgUnitId,
        days: sql<number>`(${today}::date - ${schema.project.plannedFinish})::int`,
      })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.phase, "IN_PROGRESS"),
          sql`${schema.project.plannedFinish} is not null and ${schema.project.plannedFinish} < ${today}::date`,
        ),
      );

    const candidates: { exception: Exception; weight: number; size: number }[] = [];

    for (const row of slipped) {
      const unit = byId.get(row.orgUnitId);
      if (!unit) continue;
      const severity: Exception["severity"] = row.days >= SERIOUS_SLIP_DAYS ? "red" : "amber";
      candidates.push({
        exception: this.sentence("milestoneSlip", `EXC-MS-${row.milestoneId}`, row.projectId, unit, severity, {
          milestone: row.milestoneTitle,
          project: row.projectTitle,
          days: String(row.days),
        }),
        weight: severity === "red" ? 2 : 1,
        size: row.days,
      });
    }

    for (const row of undated) {
      const unit = byId.get(row.orgUnitId);
      if (!unit) continue;
      candidates.push({
        exception: this.sentence("noPlannedDates", `EXC-ND-${row.projectId}`, row.projectId, unit, "amber", {
          project: row.projectTitle,
        }),
        weight: 1,
        size: 0,
      });
    }

    for (const row of overdue) {
      const unit = byId.get(row.orgUnitId);
      if (!unit) continue;
      candidates.push({
        exception: this.sentence("finishOverdue", `EXC-OD-${row.projectId}`, row.projectId, unit, "red", {
          project: row.projectTitle,
          days: String(row.days),
        }),
        weight: 2,
        size: row.days,
      });
    }

    // Red before amber, then by how big the slip is, so the eight that
    // survive the cap are the eight worth reading.
    candidates.sort((a, b) => b.weight - a.weight || b.size - a.size);
    return candidates.slice(0, MAX_EXCEPTIONS).map((c) => c.exception);
  }

  /**
   * The sentence is authored in both languages rather than translated live:
   * the interface never machine-translates content (CAPEX-01 §6.1), so the
   * template comes from src/i18n/{el,en}.json and the project and unit names
   * go in as they are.
   */
  private sentence(
    key: string,
    id: string,
    projectId: string,
    unit: OrgUnit,
    severity: Exception["severity"],
    params: Record<string, string>,
  ): Exception {
    return {
      id,
      projectId,
      orgUnitId: unit.id,
      sentenceEl: this.i18n.translate(`exceptions.${key}`, "el", { ...params, unit: unit.nameEl }),
      sentenceEn: this.i18n.translate(`exceptions.${key}`, "en", { ...params, unit: unit.nameEn }),
      severity,
      href: `/projects/${projectId}`,
    };
  }
}

/** % of the calendar year gone at `asOf`, UTC — the comparator every KPI tile shows. */
export function yearElapsedPct(asOf: Date): number {
  const year = asOf.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return ((asOf.getTime() - start) / (end - start)) * 100;
}

/** Twelve cumulative monthly points, evenly spread, ending exactly on `total`. */
export function linearRamp(total: number): number[] {
  const points = Array.from({ length: 12 }, (_, i) => Math.round((total * (i + 1)) / 12));
  points[11] = Math.round(total);
  return points;
}
