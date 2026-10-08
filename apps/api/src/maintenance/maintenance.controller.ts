import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import {
  MaintenanceContract,
  MaintenanceContractWrite,
  MaintenanceSummary,
  PmGenerationResult,
  PmSchedule,
  PmScheduleWrite,
  Scorecard,
  ScorecardQuery,
  SlaImportResult,
  SlaSystem,
  SlaSystemWrite,
} from "@ecapital/shared";
import type { Response } from "express";
import { z } from "zod";
import { callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { RolesGuard } from "../common/roles.guard";
import { Needs } from "../permissions/needs.guard";
import { MaintenanceContractsService } from "./contracts.service";
import { ScorecardService } from "./scorecard.service";
import { SchedulesService } from "./schedules.service";
import { WorkOrdersService } from "./work-orders.service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A catalogue upload is a table, not an archive: 5 MB is generous. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const UnitQuery = z.object({ orgUnitId: z.string().min(1).optional() });

const SystemBody = SlaSystemWrite.omit({ maintenanceContractId: true });

const ScheduleQuery = z.object({
  orgUnitId: z.string().min(1).optional(),
  maintenanceContractId: z.string().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const ScorecardParams = ScorecardQuery.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((q) => q.from < q.to);

const IMPORT_BODY = {
  type: "object",
  required: ["file"],
  properties: { file: { type: "string", format: "binary" } },
};

/**
 * M5 — Συντήρηση: the agreement, its SLA catalogue, the preventive
 * programme and the contractor scorecard (R32, R37; ADR-0031).
 *
 * Nothing here decides who may see or write a row; the row policies do
 * (ADR-0010). The `@Roles` decorators are the second lock, so an auditor's
 * mistaken POST is a 403 before a query runs (CAPEX-01 §10).
 *
 * The paths are a contract with the web app. None of them is renamed.
 */
@ApiTags("maintenance")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("maintenance")
export class MaintenanceController {
  constructor(
    private readonly contracts: MaintenanceContractsService,
    private readonly schedules: SchedulesService,
    private readonly workOrders: WorkOrdersService,
    private readonly scorecards: ScorecardService,
    private readonly i18n: I18nService,
  ) {}

  @Get("summary")
  @ApiOperation({ summary: "S18's tiles over the caller's units, or one of them" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiZodResponse(200, MaintenanceSummary, "Open orders, overdue timers, PM this month, unfunded backlog")
  @ApiZodError(401, "No token, or a token that does not verify")
  summary(@Query() query: unknown): Promise<MaintenanceSummary> {
    const parsed = UnitQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.maintenanceQueryNotValid");
    return this.workOrders.summary(parsed.data.orgUnitId ?? null);
  }

  // ---------------------------------------------------- the agreement --

  @Get("contracts")
  @ApiOperation({ summary: "The maintenance agreements the caller may see" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiZodResponse(200, z.array(MaintenanceContract), "One per agreement, with its contractor")
  @ApiZodError(401, "No token, or a token that does not verify")
  listContracts(@Query() query: unknown): Promise<MaintenanceContract[]> {
    const parsed = UnitQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.maintenanceQueryNotValid");
    return this.contracts.list(parsed.data.orgUnitId ?? null);
  }

  @Post("contracts")
  @HttpCode(201)
  @Needs("maintenanceAgreement", "MANAGE")
  @ApiOperation({ summary: "Record a maintenance agreement" })
  @ApiBody({ schema: jsonSchema(MaintenanceContractWrite) as never })
  @ApiZodResponse(201, MaintenanceContract, "The agreement as stored")
  @ApiZodError(400, "The body is not a valid agreement")
  @ApiZodError(403, "A role that does not keep agreements, or a unit the caller may not write")
  @ApiZodError(404, "A unit, contractor or capital contract that is not this caller's")
  @ApiZodError(409, "The unit already has an agreement with that reference")
  createContract(@Body() body: unknown): Promise<MaintenanceContract> {
    const parsed = MaintenanceContractWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.maintenanceContractNotValid");
    return this.contracts.create(parsed.data);
  }

  @Get("contracts/:id")
  @ApiOperation({ summary: "One maintenance agreement" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, MaintenanceContract, "The agreement")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such agreement, or none the caller may see")
  contract(@Param("id") id: string): Promise<MaintenanceContract> {
    return this.contracts.detail(id);
  }

  @Patch("contracts/:id")
  @Needs("maintenanceAgreement", "MANAGE")
  @ApiOperation({ summary: "Change an agreement; its unit does not move" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(MaintenanceContractWrite.partial()) as never })
  @ApiZodResponse(200, MaintenanceContract, "The agreement after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A role that does not keep agreements, or a unit the caller may not write")
  @ApiZodError(404, "No such agreement, or none the caller may see")
  @ApiZodError(409, "The unit already has an agreement with that reference")
  @ApiZodError(422, "An attempt to move the agreement to another unit")
  updateContract(@Param("id") id: string, @Body() body: unknown): Promise<MaintenanceContract> {
    const parsed = MaintenanceContractWrite.partial().safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.maintenanceContractNotValid");
    return this.contracts.update(id, sentKeysOnly(parsed.data, body));
  }

  // ---------------------------------------------------- the catalogue --

  @Get("contracts/:id/systems")
  @ApiOperation({ summary: "The agreement's SLA catalogue, in the table's own order" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(SlaSystem), "One line per system")
  @ApiZodError(404, "No such agreement, or none the caller may see")
  systems(@Param("id") id: string): Promise<SlaSystem[]> {
    return this.contracts.systems(id);
  }

  @Post("contracts/:id/systems")
  @HttpCode(201)
  @Needs("maintenanceAgreement", "MANAGE")
  @ApiOperation({ summary: "Add a line to the catalogue" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SystemBody) as never })
  @ApiZodResponse(201, SlaSystem, "The line as stored")
  @ApiZodError(400, "The body is not a valid catalogue line")
  @ApiZodError(403, "A role that does not keep the catalogue, or a unit the caller may not write")
  @ApiZodError(404, "No such agreement, or none the caller may see")
  @ApiZodError(409, "The agreement already has a line with that code")
  createSystem(@Param("id") id: string, @Body() body: unknown): Promise<SlaSystem> {
    const parsed = SystemBody.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.slaSystemNotValid");
    return this.contracts.createSystem(id, parsed.data);
  }

  /**
   * R32. The contract's table as .xlsx — the template's format — matched to
   * existing lines by code. Bad rows come back with their number and a Greek
   * sentence; the good ones are written in one transaction.
   */
  @Post("contracts/:id/systems/import")
  @HttpCode(201)
  @Needs("maintenanceAgreement", "MANAGE")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Import the SLA catalogue from the contract's table (.xlsx)" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: IMPORT_BODY })
  @ApiZodResponse(201, SlaImportResult, "Created, updated, unchanged, and the rows that need fixing")
  @ApiZodError(400, "No file, or a file that is not an .xlsx workbook")
  @ApiZodError(403, "A role that does not keep the catalogue, or a unit the caller may not write")
  @ApiZodError(404, "No such agreement, or none the caller may see")
  importSystems(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SlaImportResult> {
    if (!file?.buffer?.length) throw AppError.badRequest("errors.slaImportFileNeeded");
    return this.contracts.importSystems(id, file.buffer);
  }

  @Get("contracts/:id/systems/template.xlsx")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "The catalogue as .xlsx: the import format, with the current lines" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodError(404, "No such agreement, or none the caller may see")
  async template(
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { ref, file } = await this.contracts.template(id);
    response.setHeader("Content-Type", XLSX);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="ecapital-sla-${safeName(ref)}.xlsx"`,
    );
    return new StreamableFile(file);
  }

  @Patch("systems/:id")
  @Needs("maintenanceAgreement", "MANAGE")
  @ApiOperation({ summary: "Change a catalogue line — typing in a rate the copy lost, say" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SystemBody.partial()) as never })
  @ApiZodResponse(200, SlaSystem, "The line after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A role that does not keep the catalogue, or a unit the caller may not write")
  @ApiZodError(404, "No such line, or none the caller may see")
  @ApiZodError(409, "The agreement already has a line with that code")
  updateSystem(@Param("id") id: string, @Body() body: unknown): Promise<SlaSystem> {
    const parsed = SystemBody.partial().safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.slaSystemNotValid");
    return this.contracts.updateSystem(id, sentKeysOnly(parsed.data, body));
  }

  // ---------------------------------------------------- the programme --

  @Get("schedules")
  @ApiOperation({ summary: "The preventive programme, with each line's open order" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiQuery({ name: "maintenanceContractId", required: false })
  @ApiQuery({ name: "active", required: false, schema: { type: "boolean" } })
  @ApiZodResponse(200, z.array(PmSchedule), "One per programme line, next due first")
  @ApiZodError(400, "The filters are not usable")
  schedulesList(@Query() query: unknown): Promise<PmSchedule[]> {
    const parsed = ScheduleQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.maintenanceQueryNotValid");
    return this.schedules.list(parsed.data);
  }

  @Post("schedules")
  @HttpCode(201)
  @Needs("maintenanceAgreement", "MANAGE")
  @ApiOperation({ summary: "Add a programme line; the agreement is the catalogue line's" })
  @ApiBody({ schema: jsonSchema(PmScheduleWrite) as never })
  @ApiZodResponse(201, PmSchedule, "The line as stored")
  @ApiZodError(400, "The body is not a valid programme line")
  @ApiZodError(403, "A role that does not keep the programme, or a unit the caller may not write")
  @ApiZodError(404, "A catalogue line or asset that is not this caller's")
  createSchedule(@Body() body: unknown): Promise<PmSchedule> {
    const parsed = PmScheduleWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.pmScheduleNotValid");
    return this.schedules.create(parsed.data);
  }

  /**
   * «Έκδοση τώρα»: the hourly sweep's pass, now, as the caller — PM orders
   * inside their lead time and the escalation stamps. Idempotent.
   */
  @Post("schedules/generate")
  @HttpCode(200)
  @Needs("maintenanceAgreement", "MANAGE")
  @ApiOperation({ summary: "Run the programme pass now: issue due PM orders, stamp late calls" })
  @ApiZodResponse(200, PmGenerationResult, "What the pass issued, skipped and escalated")
  @ApiZodError(403, "A role that does not keep the programme")
  async generate(): Promise<PmGenerationResult> {
    return this.schedules.generate(new Date(), await callerUserId());
  }

  @Patch("schedules/:id")
  @Needs("maintenanceAgreement", "MANAGE")
  @ApiOperation({ summary: "Change a programme line" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(PmScheduleWrite.partial()) as never })
  @ApiZodResponse(200, PmSchedule, "The line after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A role that does not keep the programme, or a unit the caller may not write")
  @ApiZodError(404, "No such line, or a catalogue line or asset that is not this caller's")
  updateSchedule(@Param("id") id: string, @Body() body: unknown): Promise<PmSchedule> {
    const parsed = PmScheduleWrite.partial().safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.pmScheduleNotValid");
    return this.schedules.update(id, sentKeysOnly(parsed.data, body));
  }

  // ---------------------------------------------------- the scorecard --

  @Get("scorecard")
  @ApiOperation({ summary: "Αξιολόγηση αναδόχου: one agreement, one period, computed on read" })
  @ApiQuery({ name: "maintenanceContractId", required: true })
  @ApiQuery({ name: "from", required: true, description: "ISO date, inclusive" })
  @ApiQuery({ name: "to", required: true, description: "ISO date, exclusive" })
  @ApiZodResponse(200, Scorecard, "Counts, the timers' on-time ratios, availability and penalties")
  @ApiZodError(400, "The agreement or the period is missing or the wrong way round")
  @ApiZodError(404, "No such agreement, or none the caller may see")
  scorecard(@Query() query: unknown): Promise<Scorecard> {
    const parsed = ScorecardParams.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.scorecardQueryNotValid");
    return this.scorecards.scorecard(parsed.data);
  }

  /**
   * R37 as a workbook: «Εντολές» with one row per order, and «Αξιολόγηση»
   * whose every ratio, penalty and total is a formula over it — the owner's
   * requirement, so finance can audit the figure it withholds.
   */
  @Get("scorecard.xlsx")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "The scorecard as Excel, with live formulas" })
  @ApiQuery({ name: "maintenanceContractId", required: true })
  @ApiQuery({ name: "from", required: true })
  @ApiQuery({ name: "to", required: true })
  @ApiZodError(400, "The agreement or the period is missing or the wrong way round")
  @ApiZodError(404, "No such agreement, or none the caller may see")
  async scorecardWorkbook(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const parsed = ScorecardParams.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.scorecardQueryNotValid");
    const { ref, file } = await this.scorecards.workbook(parsed.data, this.i18n);
    response.setHeader("Content-Type", XLSX);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="ecapital-scorecard-${safeName(ref)}-${parsed.data.from}.xlsx"`,
    );
    return new StreamableFile(file);
  }
}

/** «Α.Ο 42/24» is a fine reference and a poor file name. ASCII only in the header. */
export function safeName(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "export"
  );
}
