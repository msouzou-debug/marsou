/**
 * M6 — Αναφορές (R39, CAPEX-01 §11; ADR-0032). Seven reports, computed on
 * read from the services M1–M5 already have; nothing here is stored and no
 * table was added for it.
 *
 * There is no unit check in this file (ADR-0010). Every query runs inside
 * the caller's transaction, so the row policies decide which units, projects,
 * contracts, assets and orders exist for them: a head of estates at Larnaca
 * gets reports about Larnaca. The optional unit filter narrows inside that;
 * a unit the caller may not see is a 404, the same one a misspelt id gets.
 *
 * NO PATIENT DATA: hospitals, projects, machines, hours and money.
 */
import { Injectable } from "@nestjs/common";
import {
  type AssetLifecycleReport,
  type BacklogByBandReport,
  type BacklogByBandRow,
  type CapitalContractorRow,
  type CapitalProgrammeReport,
  type ClinicalDisruptionReport,
  type ContractorScorecardReport,
  type ExceptionRow,
  type ExceptionsReport,
  OrgUnit,
  ProjectListQuery,
  type ProjectSummary,
  RISK_BAND_ORDER,
  type ReportKey,
  type ReportMeta,
  REPORT_CATALOGUE,
  type StatutoryComplianceReport,
} from "@ecapital/shared";
import { and, asc, eq, gte, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { AppError } from "../common/errors";
import { addDays as addContractDays, warningFacts } from "../contracts/contract-rows";
import { ProjectCostService } from "../cost/project-cost.service";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { BacklogService } from "../maintenance/backlog.service";
import { MaintenanceContractsService } from "../maintenance/contracts.service";
import { downtimeHours } from "../maintenance/maintenance-rules";
import { ScorecardService } from "../maintenance/scorecard.service";
import { CalendarService } from "../permits/calendar.service";
import { PortfolioService } from "../portfolio/portfolio.service";
import { money } from "../projects/project-rows";
import { ProjectsService } from "../projects/projects.service";
import type { ResolvedQuery } from "./report-query";
import {
  type CapitalContractorFacts,
  type LifecycleAsset,
  assetLifecycleRow,
  capitalContractorRow,
  isHighRisk,
  milestoneLateDays,
  monthsOf,
  round2,
  slippageOf,
  sortExceptions,
  sortLifecycle,
  pctOf,
  sumComplete,
  sumKnown,
  yearElapsedFor,
} from "./report-rows";
import { type StatutoryOrder, statutoryCategoryOf, statutoryCounts } from "./statutory";

interface UnitName {
  id: string;
  nameEl: string;
}

/** The capital contractor row plus the two counts the workbook's formulas need. */
export interface CapitalContractorLine {
  row: CapitalContractorRow;
  facts: CapitalContractorFacts;
}

/** What the contractor report's workbook needs beyond the JSON. */
export interface ContractorScorecardData {
  report: ContractorScorecardReport;
  capital: CapitalContractorLine[];
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly projects: ProjectsService,
    private readonly projectCost: ProjectCostService,
    private readonly backlog: BacklogService,
    private readonly maintenanceContracts: MaintenanceContractsService,
    private readonly scorecards: ScorecardService,
    private readonly calendar: CalendarService,
  ) {}

  catalogue() {
    return REPORT_CATALOGUE;
  }

  // -------------------------------------------- 1. capital programme --

  /**
   * §11: approved, committed, spent, forecast, slippage, % of year elapsed
   * against % spent, one row per unit the caller may see. Approved,
   * committed, the project count and the RAG split are the portfolio's own
   * unit rows (S01), so the two screens agree. Spent and forecast are the
   * cost module's ledgers (R13, R16) summed over the unit's projects: spent
   * over the projects that have postings, the forecast only when every
   * project has one (`sumComplete`).
   */
  async capitalProgramme(query: ResolvedQuery, now: Date): Promise<CapitalProgrammeReport> {
    const unit = await this.unitFilter(query.orgUnitId);
    const built = await this.portfolio.build(now);
    const unitRows = built.units.filter((row) => !unit || row.orgUnit.id === unit.id);

    const ledgers = await this.projectLedgers(unit?.id ?? null);
    const rows = unitRows.map((unitRow) => {
      const mine = ledgers.filter((p) => p.orgUnitId === unitRow.orgUnit.id);
      const spent = sumKnown(mine.map((p) => p.spent));
      const forecast = sumComplete(mine.map((p) => p.forecast));
      return {
        orgUnit: OrgUnit.parse(unitRow.orgUnit),
        projectCount: unitRow.projectCount,
        approved: unitRow.approved,
        committed: unitRow.committed ?? null,
        spent,
        forecast,
        slippage: slippageOf(forecast, unitRow.approved),
        spentPct: pctOf(spent, unitRow.approved),
        rag: unitRow.rag,
      };
    });

    return {
      meta: this.meta("CAPITAL_PROGRAMME", unit, query, now),
      yearElapsedPct: yearElapsedFor(query.year, now),
      rows,
    };
  }

  // ---------------------------------------------------- 2. exceptions --

  /**
   * §11: every project the caller may see whose RAG is amber or red, with
   * its reason, its owner (the project manager, else the sponsor), the
   * forecast against approved, the worst late milestone and the open risks
   * scored high.
   */
  async exceptions(query: ResolvedQuery, now: Date): Promise<ExceptionsReport> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const unit = await this.unitFilter(query.orgUnitId);
    const today = now.toISOString().slice(0, 10);

    const flagged = await this.allProjects({ unit: unit ? [unit.id] : [], rag: ["AMBER", "RED"] });
    const ids = flagged.map((p) => p.id);
    const units = new Map((await this.visibleUnits()).map((u) => [u.id, u.nameEl]));

    const milestones = ids.length
      ? await tx.db
          .select({
            projectId: schema.milestone.projectId,
            baselineDate: schema.milestone.baselineDate,
            forecastDate: schema.milestone.forecastDate,
            actualDate: schema.milestone.actualDate,
          })
          .from(schema.milestone)
          .where(inArray(schema.milestone.projectId, ids))
      : [];
    const risks = ids.length
      ? await tx.db
          .select({
            projectId: schema.risk.projectId,
            likelihood: schema.risk.likelihood,
            impact: schema.risk.impact,
          })
          .from(schema.risk)
          .where(and(inArray(schema.risk.projectId, ids), eq(schema.risk.status, "OPEN")))
      : [];
    const owners = ids.length
      ? await tx.db
          .select({
            id: schema.project.id,
            ownerName: sql<string | null>`coalesce(
              ecapital.user_display_name(${schema.project.projectManagerId}),
              ecapital.user_display_name(${schema.project.sponsorId}))`,
          })
          .from(schema.project)
          .where(inArray(schema.project.id, ids))
      : [];
    const ownerOf = new Map(owners.map((o) => [o.id, o.ownerName ?? null]));

    const rows: ExceptionRow[] = [];
    for (const project of flagged) {
      const { forecast } = await this.projectCost.reportLedgersOf(project.id);
      const approved = project.approvedBudget;
      rows.push({
        projectId: project.id,
        projectCode: project.code,
        titleEl: project.titleEl,
        orgUnitId: project.orgUnitId,
        orgUnitName: units.get(project.orgUnitId) ?? "",
        phase: project.phase,
        rag: project.rag,
        ragReason: project.ragReason,
        ownerName: ownerOf.get(project.id) ?? null,
        approved,
        forecast,
        slippage: slippageOf(forecast, approved),
        milestoneLateDays: milestoneLateDays(
          milestones.filter((m) => m.projectId === project.id),
          today,
        ),
        openRisksHigh: risks.filter((r) => r.projectId === project.id && isHighRisk(r.likelihood, r.impact))
          .length,
      });
    }

    return { meta: this.meta("EXCEPTIONS", unit, query, now), rows: sortExceptions(rows) };
  }

  // ------------------------------------------ 3. contractor scorecard --

  async contractorScorecard(query: ResolvedQuery, now: Date): Promise<ContractorScorecardReport> {
    return (await this.contractorScorecardData(query, now)).report;
  }

  /**
   * §11: two halves, because ΟΚΥπΥ has two kinds of contractor.
   *
   * Capital (ADR-0032 §5): every contractor with a contract in the caller's
   * units, figures as at today over all their contracts there. Overdue is the
   * contract warning's own rule (`warningFacts` «completionPast»: completion
   * date plus extension gone by while the project is short of
   * PRACTICAL_COMPLETION). An RFI is late when it was answered after its SLA
   * or is still unanswered past it.
   *
   * Claim accuracy reads the certificates the engineer has decided
   * (ENGINEER_APPROVED onwards; a DRAFT is a claim nobody has ruled on yet
   * and counts nowhere): the net payable as certified over the net payable as
   * raised. FLAG: the register keeps one figure per certificate and no route
   * changes it after it is raised, so today the two sums are the same and a
   * contractor with a decided certificate scores 100. The day a «claimed»
   * figure is recorded beside the certified one, only the first sum changes.
   *
   * Maintenance: the M5 scorecard of every ACTIVE agreement in the caller's
   * units for [from, to), exactly as S22 shows it.
   */
  async contractorScorecardData(query: ResolvedQuery, now: Date): Promise<ContractorScorecardData> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const unit = await this.unitFilter(query.orgUnitId);
    const today = now.toISOString().slice(0, 10);
    const c = schema.contract;

    const contracts = await tx.db
      .select({
        id: c.id,
        contractorId: c.contractorId,
        contractorName: schema.contractor.name,
        contractNo: c.contractNo,
        originalValue: c.originalValue,
        currentValue: c.currentValue,
        completionDate: c.completionDate,
        extensionDays: c.extensionDays,
        phase: schema.project.phase,
        approvedVariations: sql<string>`coalesce((select sum(v.value) from ecapital.variation v
          where v.contract_id = ${c.id} and v.status = 'APPROVED'), 0)`,
        defects: sql<number>`(select count(*)::int from ecapital.defect d where d.contract_id = ${c.id})`,
        openDefects: sql<number>`(select count(*)::int from ecapital.defect d
          where d.contract_id = ${c.id} and d.status <> 'CLOSED')`,
        rfis: sql<number>`(select count(*)::int from ecapital.rfi r where r.contract_id = ${c.id})`,
        rfisLate: sql<number>`(select count(*)::int from ecapital.rfi r
          where r.contract_id = ${c.id}
            and ((r.answered_at is not null and r.answered_at > r.sla_due_at)
              or (r.answered_at is null and r.sla_due_at < ${now.toISOString()}::timestamptz)))`,
        certificates: sql<number>`(select count(*)::int from ecapital.payment_cert p
          where p.contract_id = ${c.id} and p.status <> 'DRAFT')`,
        certifiedClaimed: sql<string>`coalesce((select sum(p.net_payable) from ecapital.payment_cert p
          where p.contract_id = ${c.id} and p.status <> 'DRAFT'), 0)`,
        certifiedApproved: sql<string>`coalesce((select sum(p.net_payable) from ecapital.payment_cert p
          where p.contract_id = ${c.id} and p.status <> 'DRAFT'), 0)`,
      })
      .from(c)
      .innerJoin(schema.contractor, eq(schema.contractor.id, c.contractorId))
      .innerJoin(schema.project, eq(schema.project.id, c.projectId))
      .where(unit ? eq(c.orgUnitId, unit.id) : undefined);

    const byContractor = new Map<string, CapitalContractorFacts>();
    for (const row of contracts) {
      const facts =
        byContractor.get(row.contractorId) ??
        ({
          contractorId: row.contractorId,
          contractorName: row.contractorName,
          contracts: 0,
          datedContracts: 0,
          overdueContracts: 0,
          originalValue: 0,
          approvedVariations: 0,
          contractValue: 0,
          defects: 0,
          openDefects: 0,
          rfis: 0,
          rfisLate: 0,
          certificates: 0,
          certifiedClaimed: 0,
          certifiedApproved: 0,
        } satisfies CapitalContractorFacts);
      const overdue = warningFacts(
        {
          contractNo: row.contractNo,
          projectTitleEl: "",
          originalValue: money(row.originalValue),
          approvedVariationsTotal: money(row.approvedVariations),
          bondExpiry: null,
          completionDate: row.completionDate,
          extensionDays: row.extensionDays,
          projectPhase: row.phase,
          instructionsWithoutVariation: 0,
        },
        today,
      ).some((fact) => fact.key === "completionPast");
      facts.contracts += 1;
      if (row.completionDate) facts.datedContracts += 1;
      if (overdue) facts.overdueContracts += 1;
      facts.originalValue = round2(facts.originalValue + money(row.originalValue));
      facts.approvedVariations = round2(facts.approvedVariations + money(row.approvedVariations));
      facts.contractValue = round2(facts.contractValue + money(row.currentValue));
      facts.defects += row.defects;
      facts.openDefects += row.openDefects;
      facts.rfis += row.rfis;
      facts.rfisLate += row.rfisLate;
      facts.certificates += row.certificates;
      facts.certifiedClaimed = round2(facts.certifiedClaimed + money(row.certifiedClaimed));
      facts.certifiedApproved = round2(facts.certifiedApproved + money(row.certifiedApproved));
      byContractor.set(row.contractorId, facts);
    }
    const capital = [...byContractor.values()]
      .sort((a, b) => a.contractorName.localeCompare(b.contractorName, "el"))
      .map((facts) => ({ row: capitalContractorRow(facts), facts }));

    const agreements = (await this.maintenanceContracts.list(unit?.id ?? null)).filter(
      (agreement) => agreement.status === "ACTIVE",
    );
    const maintenance = [];
    for (const agreement of agreements) {
      maintenance.push(
        await this.scorecards.scorecard({
          maintenanceContractId: agreement.id,
          from: query.from,
          to: query.to,
        }),
      );
    }

    return {
      report: {
        meta: this.meta("CONTRACTOR_SCORECARD", unit, query, now),
        capital: capital.map((line) => line.row),
        maintenance,
      },
      capital,
    };
  }

  // --------------------------------------------- 4. backlog by band --

  /**
   * §11: S21's own summary (OPEN and FUNDED), pivoted to one row per unit
   * the caller may see with all four bands in RISK_BAND_ORDER, zeros where a
   * band has nothing.
   */
  async backlogByBand(query: ResolvedQuery, now: Date): Promise<BacklogByBandReport> {
    const unit = await this.unitFilter(query.orgUnitId);
    const summary = await this.backlog.summary(unit?.id ?? null);
    const units = unit ? [unit] : await this.visibleUnits();
    const rows = units.map((u) => {
      const bands: BacklogByBandRow["bands"] = RISK_BAND_ORDER.map((band) => {
        const hit = summary.find((s) => s.orgUnitId === u.id && s.riskBand === band);
        return {
          riskBand: band,
          count: hit?.count ?? 0,
          costEstimate: round2(hit?.costEstimate ?? 0),
          fundedCost: round2(hit?.fundedCost ?? 0),
          unfundedCost: round2(hit?.unfundedCost ?? 0),
        };
      });
      return {
        orgUnitId: u.id,
        orgUnitName: u.nameEl,
        bands,
        total: round2(bands.reduce((sum, b) => sum + b.costEstimate, 0)),
        funded: round2(bands.reduce((sum, b) => sum + b.fundedCost, 0)),
        unfunded: round2(bands.reduce((sum, b) => sum + b.unfundedCost, 0)),
      };
    });
    return { meta: this.meta("BACKLOG_BY_BAND", unit, query, now), rows };
  }

  // ---------------------------------------------- 5. asset lifecycle --

  /**
   * §11: every asset in service or out of service (not disposed, not merely
   * planned) that carries a capital cost or a replacement year. Maintenance
   * cost is every order's actual cost, all time; corrective orders and
   * downtime count the corrective calls that were not withdrawn, downtime by
   * the M5 rule (`downtimeHours`: call to restore, or to now while down).
   */
  async assetLifecycle(query: ResolvedQuery, now: Date): Promise<AssetLifecycleReport> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const unit = await this.unitFilter(query.orgUnitId);
    const a = schema.asset;
    const filters: SQL[] = [
      inArray(a.status, ["IN_SERVICE", "OUT_OF_SERVICE"]),
      or(isNotNull(a.capitalCost), isNotNull(a.replacementYear)) as SQL,
    ];
    if (unit) filters.push(eq(a.orgUnitId, unit.id));
    const assets = await tx.db
      .select({
        assetId: a.id,
        tag: a.tag,
        nameEl: a.nameEl,
        orgUnitId: a.orgUnitId,
        orgUnitName: schema.orgUnit.nameEl,
        assetClass: a.assetClass,
        criticality: a.criticality,
        condition: a.condition,
        installedDate: a.installedDate,
        commissionedDate: a.commissionedDate,
        capitalCost: a.capitalCost,
        expectedLifeYears: a.expectedLifeYears,
        replacementYear: a.replacementYear,
        replacementCostEst: a.replacementCostEst,
      })
      .from(a)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, a.orgUnitId))
      .where(and(...filters));

    const ids = assets.map((row) => row.assetId);
    const w = schema.workOrder;
    const orders = ids.length
      ? await tx.db
          .select({
            assetId: w.assetId,
            kind: w.kind,
            status: w.status,
            costActual: w.costActual,
            calledAt: w.calledAt,
            restoredAt: w.restoredAt,
            completedAt: w.completedAt,
            cancelledAt: w.cancelledAt,
          })
          .from(w)
          .where(inArray(w.assetId, ids))
      : [];

    const nowIso = now.toISOString();
    const rows = assets.map((row) => {
      const mine = orders.filter((o) => o.assetId === row.assetId);
      const corrective = mine.filter((o) => o.kind === "CORRECTIVE" && o.status !== "CANCELLED");
      const asset: LifecycleAsset = {
        ...row,
        capitalCost: row.capitalCost === null ? null : money(row.capitalCost),
        replacementCostEst: row.replacementCostEst === null ? null : money(row.replacementCostEst),
      };
      return assetLifecycleRow(
        asset,
        {
          maintenanceCost: mine.reduce((sum, o) => sum + (o.costActual === null ? 0 : money(o.costActual)), 0),
          correctiveOrders: corrective.length,
          downtimeHours: corrective.reduce(
            (sum, o) =>
              sum +
              (downtimeHours(
                {
                  kind: "CORRECTIVE",
                  status: o.status,
                  calledAt: o.calledAt.toISOString(),
                  restoredAt: o.restoredAt?.toISOString() ?? null,
                  completedAt: o.completedAt?.toISOString() ?? null,
                  cancelledAt: o.cancelledAt?.toISOString() ?? null,
                  dueResponseAt: null,
                  dueRestoreAt: null,
                  dueReportAt: null,
                  respondedAt: null,
                  reportReceivedAt: null,
                },
                nowIso,
              ) ?? 0),
            0,
          ),
        },
        query.year,
      );
    });

    return { meta: this.meta("ASSET_LIFECYCLE", unit, query, now), rows: sortLifecycle(rows) };
  }

  // ------------------------------------------ 6. clinical disruption --

  /** §11: the M3 disruption hours, one row per visible unit, twelve months, zeros filled in. */
  async clinicalDisruption(query: ResolvedQuery, now: Date): Promise<ClinicalDisruptionReport> {
    const unit = await this.unitFilter(query.orgUnitId);
    const hours = await this.calendar.disruptionHours(query.year);
    const units = unit ? [unit] : await this.visibleUnits();
    const rows = units.map((u) => {
      const months = monthsOf(query.year).map((month) => {
        const hit = hours.find((h) => h.orgUnitId === u.id && h.month === month);
        return {
          month,
          theatreHours: hit?.theatreHours ?? 0,
          icuHours: hit?.icuHours ?? 0,
          permits: hit?.permits ?? 0,
        };
      });
      return {
        orgUnitId: u.id,
        orgUnitName: u.nameEl,
        months,
        theatreHoursTotal: round2(months.reduce((sum, m) => sum + m.theatreHours, 0)),
        icuHoursTotal: round2(months.reduce((sum, m) => sum + m.icuHours, 0)),
        permitsTotal: months.reduce((sum, m) => sum + m.permits, 0),
      };
    });
    return { meta: this.meta("CLINICAL_DISRUPTION", unit, query, now), rows };
  }

  // -------------------------------------------- 7. statutory compliance --

  /**
   * §11 and ADR-0032 §4: the programme orders dated in the year and the
   * STATUTORY orders called in it, mapped to the four categories by the
   * order's asset and catalogue line. An order that maps to none is not
   * counted. Four cells per visible unit, every category present.
   */
  async statutoryCompliance(query: ResolvedQuery, now: Date): Promise<StatutoryComplianceReport> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const unit = await this.unitFilter(query.orgUnitId);
    const w = schema.workOrder;
    const yearFrom = `${query.year}-01-01`;
    const yearTo = `${query.year + 1}-01-01`;

    const inYear = or(
      and(eq(w.kind, "PM"), sql`${w.dueDate} >= ${yearFrom}::date and ${w.dueDate} < ${yearTo}::date`),
      and(
        eq(w.kind, "STATUTORY"),
        gte(w.calledAt, new Date(`${yearFrom}T00:00:00Z`)),
        lt(w.calledAt, new Date(`${yearTo}T00:00:00Z`)),
      ),
    ) as SQL;
    const orders = await tx.db
      .select({
        orgUnitId: w.orgUnitId,
        status: w.status,
        dueRestoreAt: w.dueRestoreAt,
        dueDate: w.dueDate,
        completedAt: w.completedAt,
        assetClass: schema.asset.assetClass,
        assetSystem: schema.asset.system,
        lineClass: schema.slaSystem.assetClass,
        lineSystem: schema.slaSystem.permitSystem,
        lineName: schema.slaSystem.nameEl,
      })
      .from(w)
      .leftJoin(schema.asset, eq(schema.asset.id, w.assetId))
      .leftJoin(schema.slaSystem, eq(schema.slaSystem.id, w.slaSystemId))
      .where(unit ? and(inYear, eq(w.orgUnitId, unit.id)) : inYear);

    const categorised: StatutoryOrder[] = [];
    for (const order of orders) {
      const category = statutoryCategoryOf({
        assetClasses: [order.assetClass, order.lineClass],
        permitSystems: [order.assetSystem, order.lineSystem],
        systemName: order.lineName,
      });
      if (!category) continue;
      // The order's own deadline (a PM order's is the end of its programme
      // day); the programme date's end where no deadline was stamped.
      const deadline =
        order.dueRestoreAt?.toISOString() ??
        (order.dueDate ? `${addContractDays(order.dueDate, 1)}T00:00:00.000Z` : null);
      categorised.push({
        orgUnitId: order.orgUnitId,
        category,
        status: order.status,
        deadline,
        completedAt: order.completedAt?.toISOString() ?? null,
      });
    }

    const nowIso = now.toISOString();
    const units = unit ? [unit] : await this.visibleUnits();
    const rows = units.map((u) => ({
      orgUnitId: u.id,
      orgUnitName: u.nameEl,
      cells: statutoryCounts(
        categorised.filter((o) => o.orgUnitId === u.id),
        nowIso,
      ),
    }));
    return { meta: this.meta("STATUTORY_COMPLIANCE", unit, query, now), rows };
  }

  // ------------------------------------------------------------ helpers --

  /** The unit the filter names, or null for every unit; 404 for one the caller cannot see. */
  async unitFilter(orgUnitId: string | null): Promise<UnitName | null> {
    if (!orgUnitId) return null;
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ id: schema.orgUnit.id, nameEl: schema.orgUnit.nameEl })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, orgUnitId))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.unitNotFound");
    return rows[0];
  }

  /** The units the row policy lets the caller see, by Greek name. */
  private async visibleUnits(): Promise<UnitName[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    return tx.db
      .select({ id: schema.orgUnit.id, nameEl: schema.orgUnit.nameEl })
      .from(schema.orgUnit)
      .orderBy(asc(schema.orgUnit.nameEl));
  }

  /** Every project the caller may see that matches, through the register's own list. */
  private async allProjects(filter: Partial<ProjectListQuery>): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (let page = 1; ; page += 1) {
      const query = ProjectListQuery.parse({ ...filter, sort: "code", dir: "asc", page, pageSize: 200 });
      const list = await this.projects.list(query);
      out.push(...list.items);
      if (list.items.length < query.pageSize || out.length >= list.total) break;
    }
    return out;
  }

  /** Spent and forecast of every project the caller may see (in one unit, when filtered). */
  private async projectLedgers(
    orgUnitId: string | null,
  ): Promise<{ orgUnitId: string; spent: number | null; forecast: number | null }[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const projects = await tx.db
      .select({ id: schema.project.id, orgUnitId: schema.project.orgUnitId })
      .from(schema.project)
      .where(orgUnitId ? eq(schema.project.orgUnitId, orgUnitId) : undefined);
    const out = [];
    for (const project of projects) {
      const ledgers = await this.projectCost.reportLedgersOf(project.id);
      out.push({ orgUnitId: project.orgUnitId, ...ledgers });
    }
    return out;
  }

  private meta(key: ReportKey, unit: UnitName | null, query: ResolvedQuery, now: Date): ReportMeta {
    const entry = REPORT_CATALOGUE.find((e) => e.key === key);
    return {
      key,
      generatedAt: now.toISOString(),
      orgUnitId: unit?.id ?? null,
      orgUnitName: unit?.nameEl ?? null,
      year: entry?.takesYear ? query.year : null,
      from: entry?.takesPeriod ? query.from : null,
      to: entry?.takesPeriod ? query.to : null,
    };
  }
}
