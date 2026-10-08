import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  StreamableFile,
  UseGuards,
  applyDecorators,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  AssetLifecycleReport,
  BacklogByBandReport,
  CapitalProgrammeReport,
  ClinicalDisruptionReport,
  ContractorScorecardReport,
  ExceptionsReport,
  REPORT_CATALOGUE,
  REPORT_SLUG,
  ReportCatalogueEntry,
  type ReportKey,
  StatutoryComplianceReport,
} from "@ecapital/shared";
import type { Response } from "express";
import { z } from "zod";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { Needs } from "../permissions/needs.guard";
import { type ResolvedQuery, parseReportQuery } from "./report-query";
import {
  assetLifecycleWorkbook,
  backlogByBandWorkbook,
  capitalProgrammeWorkbook,
  clinicalDisruptionWorkbook,
  contractorScorecardWorkbook,
  exceptionsWorkbook,
  statutoryComplianceWorkbook,
} from "./reports-export";
import { ReportsService } from "./reports.service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The filters a report's route documents: the ones `REPORT_CATALOGUE` says it takes. */
function ReportFilters(key: ReportKey) {
  const entry = REPORT_CATALOGUE.find((e) => e.key === key) as ReportCatalogueEntry;
  const decorators = [
    ApiQuery({ name: "orgUnitId", required: false, description: "One unit; omitted = every unit the caller may see" }),
  ];
  if (entry.takesYear) {
    decorators.push(ApiQuery({ name: "year", required: false, description: "2000–2100; default this year" }));
  }
  if (entry.takesPeriod) {
    decorators.push(
      ApiQuery({ name: "from", required: false, description: "ISO date, inclusive; default this quarter" }),
      ApiQuery({ name: "to", required: false, description: "ISO date, exclusive; default this quarter" }),
    );
  }
  return applyDecorators(
    ...decorators,
    ApiZodError(400, "A year, a date or a period that is not usable (errors.reportQueryNotValid)"),
    ApiZodError(403, "A role the reports are not for (ADR-0032 §6)"),
    ApiZodError(404, "A unit the caller may not see"),
  );
}

/** The workbook route's documentation: a file, not JSON. */
function Workbook(summary: string) {
  return applyDecorators(
    Header("Cache-Control", "no-store"),
    ApiOperation({ summary }),
    ApiProduces(XLSX),
    ApiResponse({
      status: 200,
      description: "The workbook: «Στοιχεία» with the inputs and live formulas, and «Σύνοψη»",
      content: { [XLSX]: { schema: { type: "string", format: "binary" } } },
    }),
  );
}

/**
 * M6 — Αναφορές (R39, CAPEX-01 §11; ADR-0032). Seven reports, each as JSON
 * for the screen and as an Excel workbook with live formulas; both come from
 * the same service call, so a figure on the screen is the figure in the file.
 * The PDF is the browser's print of the screen (ADR-0032 §3).
 *
 * ADR-0032 §6: the reports are for the head of estates, finance, the
 * executive, the auditor and the administrator, so `@Roles` turns everybody
 * else away with 403 before a query runs. Which rows each of them sees is
 * still the row policies' call (ADR-0010).
 *
 * The paths are a contract with the web app (`REPORT_SLUG`).
 */
@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Needs("reports", "READ")
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @ApiOperation({ summary: "The report catalogue: the seven reports and the filters each takes" })
  @ApiZodResponse(200, z.array(ReportCatalogueEntry), "One entry per report, in the order S23 lists them")
  @ApiZodError(403, "A role the reports are not for (ADR-0032 §6)")
  catalogue(): ReportCatalogueEntry[] {
    return this.reports.catalogue();
  }

  // ---------------------------------------------- 1. capital programme --

  @Get(REPORT_SLUG.CAPITAL_PROGRAMME)
  @ApiOperation({ summary: "Capital programme by unit: approved, committed, spent, forecast, slippage" })
  @ReportFilters("CAPITAL_PROGRAMME")
  @ApiZodResponse(200, CapitalProgrammeReport, "One row per visible unit and the share of the year elapsed")
  capitalProgramme(@Query() query: unknown): Promise<CapitalProgrammeReport> {
    const now = new Date();
    return this.reports.capitalProgramme(parseReportQuery(query, now), now);
  }

  @Get(`${REPORT_SLUG.CAPITAL_PROGRAMME}.xlsx`)
  @Workbook("Capital programme by unit as Excel, with live formulas")
  @ReportFilters("CAPITAL_PROGRAMME")
  async capitalProgrammeXlsx(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const parsed = parseReportQuery(query, now);
    const report = await this.reports.capitalProgramme(parsed, now);
    return this.send(response, "CAPITAL_PROGRAMME", parsed, await capitalProgrammeWorkbook(report, this.i18n));
  }

  // ----------------------------------------------------- 2. exceptions --

  @Get(REPORT_SLUG.EXCEPTIONS)
  @ApiOperation({ summary: "Projects at amber or red, with reason, owner, slippage, late milestone, high risks" })
  @ReportFilters("EXCEPTIONS")
  @ApiZodResponse(200, ExceptionsReport, "Red first, then amber, then by slippage")
  exceptions(@Query() query: unknown): Promise<ExceptionsReport> {
    const now = new Date();
    return this.reports.exceptions(parseReportQuery(query, now), now);
  }

  @Get(`${REPORT_SLUG.EXCEPTIONS}.xlsx`)
  @Workbook("Exceptions as Excel, with live formulas")
  @ReportFilters("EXCEPTIONS")
  async exceptionsXlsx(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const parsed = parseReportQuery(query, now);
    const report = await this.reports.exceptions(parsed, now);
    return this.send(response, "EXCEPTIONS", parsed, await exceptionsWorkbook(report, this.i18n));
  }

  // ------------------------------------------ 3. contractor scorecard --

  @Get(REPORT_SLUG.CONTRACTOR_SCORECARD)
  @ApiOperation({ summary: "Αξιολόγηση αναδόχων: capital contractors and every active maintenance agreement" })
  @ReportFilters("CONTRACTOR_SCORECARD")
  @ApiZodResponse(200, ContractorScorecardReport, "Capital rows per contractor and one M5 scorecard per agreement")
  contractorScorecard(@Query() query: unknown): Promise<ContractorScorecardReport> {
    const now = new Date();
    return this.reports.contractorScorecard(parseReportQuery(query, now), now);
  }

  @Get(`${REPORT_SLUG.CONTRACTOR_SCORECARD}.xlsx`)
  @Workbook("Contractor scorecard as Excel, with live formulas")
  @ReportFilters("CONTRACTOR_SCORECARD")
  async contractorScorecardXlsx(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const parsed = parseReportQuery(query, now);
    const data = await this.reports.contractorScorecardData(parsed, now);
    return this.send(response, "CONTRACTOR_SCORECARD", parsed, await contractorScorecardWorkbook(data, this.i18n));
  }

  // ---------------------------------------------- 4. backlog by band --

  @Get(REPORT_SLUG.BACKLOG_BY_BAND)
  @ApiOperation({ summary: "Εκκρεμότητες συντήρησης by unit and risk band, funded and unfunded" })
  @ReportFilters("BACKLOG_BY_BAND")
  @ApiZodResponse(200, BacklogByBandReport, "One row per visible unit, all four bands")
  backlogByBand(@Query() query: unknown): Promise<BacklogByBandReport> {
    const now = new Date();
    return this.reports.backlogByBand(parseReportQuery(query, now), now);
  }

  @Get(`${REPORT_SLUG.BACKLOG_BY_BAND}.xlsx`)
  @Workbook("Backlog by risk band as Excel, with live formulas")
  @ReportFilters("BACKLOG_BY_BAND")
  async backlogByBandXlsx(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const parsed = parseReportQuery(query, now);
    const report = await this.reports.backlogByBand(parsed, now);
    return this.send(response, "BACKLOG_BY_BAND", parsed, await backlogByBandWorkbook(report, this.i18n));
  }

  // ----------------------------------------------- 5. asset lifecycle --

  @Get(REPORT_SLUG.ASSET_LIFECYCLE)
  @ApiOperation({ summary: "Asset lifecycle: capital and maintenance cost, downtime, remaining life" })
  @ReportFilters("ASSET_LIFECYCLE")
  @ApiZodResponse(200, AssetLifecycleReport, "Shortest remaining life first")
  assetLifecycle(@Query() query: unknown): Promise<AssetLifecycleReport> {
    const now = new Date();
    return this.reports.assetLifecycle(parseReportQuery(query, now), now);
  }

  @Get(`${REPORT_SLUG.ASSET_LIFECYCLE}.xlsx`)
  @Workbook("Asset lifecycle as Excel, with live formulas")
  @ReportFilters("ASSET_LIFECYCLE")
  async assetLifecycleXlsx(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const parsed = parseReportQuery(query, now);
    const report = await this.reports.assetLifecycle(parsed, now);
    return this.send(response, "ASSET_LIFECYCLE", parsed, await assetLifecycleWorkbook(report, this.i18n));
  }

  // ------------------------------------------- 6. clinical disruption --

  @Get(REPORT_SLUG.CLINICAL_DISRUPTION)
  @ApiOperation({ summary: "Theatre and ICU hours lost to planned works, by unit and month" })
  @ReportFilters("CLINICAL_DISRUPTION")
  @ApiZodResponse(200, ClinicalDisruptionReport, "One row per visible unit, twelve months")
  clinicalDisruption(@Query() query: unknown): Promise<ClinicalDisruptionReport> {
    const now = new Date();
    return this.reports.clinicalDisruption(parseReportQuery(query, now), now);
  }

  @Get(`${REPORT_SLUG.CLINICAL_DISRUPTION}.xlsx`)
  @Workbook("Clinical disruption as Excel, with live formulas")
  @ReportFilters("CLINICAL_DISRUPTION")
  async clinicalDisruptionXlsx(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const parsed = parseReportQuery(query, now);
    const report = await this.reports.clinicalDisruption(parsed, now);
    return this.send(response, "CLINICAL_DISRUPTION", parsed, await clinicalDisruptionWorkbook(report, this.i18n));
  }

  // ------------------------------------------ 7. statutory compliance --

  @Get(REPORT_SLUG.STATUTORY_COMPLIANCE)
  @ApiOperation({ summary: "Lifts, pressure vessels, medical gas, fire systems: due, done, overdue" })
  @ReportFilters("STATUTORY_COMPLIANCE")
  @ApiZodResponse(200, StatutoryComplianceReport, "Four categories per visible unit")
  statutoryCompliance(@Query() query: unknown): Promise<StatutoryComplianceReport> {
    const now = new Date();
    return this.reports.statutoryCompliance(parseReportQuery(query, now), now);
  }

  @Get(`${REPORT_SLUG.STATUTORY_COMPLIANCE}.xlsx`)
  @Workbook("Statutory compliance as Excel, with live formulas")
  @ReportFilters("STATUTORY_COMPLIANCE")
  async statutoryComplianceXlsx(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const now = new Date();
    const parsed = parseReportQuery(query, now);
    const report = await this.reports.statutoryCompliance(parsed, now);
    return this.send(response, "STATUTORY_COMPLIANCE", parsed, await statutoryComplianceWorkbook(report, this.i18n));
  }

  // ------------------------------------------------------------ helpers --

  /**
   * `ecapital-<slug>-<year|from_to>.xlsx`: the period for a report that takes
   * one, the year otherwise (for the two that take neither, the year the
   * figures were read in).
   */
  private send(response: Response, key: ReportKey, query: ResolvedQuery, file: Buffer): StreamableFile {
    const entry = REPORT_CATALOGUE.find((e) => e.key === key) as ReportCatalogueEntry;
    const stamp = entry.takesPeriod
      ? `${query.from}_${query.to}`
      : String(entry.takesYear ? query.year : new Date().getUTCFullYear());
    response.setHeader("Content-Type", XLSX);
    response.setHeader("Content-Disposition", `attachment; filename="ecapital-${REPORT_SLUG[key]}-${stamp}.xlsx"`);
    return new StreamableFile(file);
  }
}
