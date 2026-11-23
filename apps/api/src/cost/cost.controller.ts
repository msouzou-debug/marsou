import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
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
import type { Response } from "express";
import { Allocation, AccrualRow, SapReport, UnmatchedQueue } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { Needs, NeedsAny } from "../permissions/needs.guard";
import {
  AccrualQuery,
  AllocationResult,
  ConnectorImportRequest,
  ImportBatchList,
  ImportBatchResult,
  ImportRequest,
  SkipRequest,
} from "./cost-contracts";
import { CostAccrualsService } from "./cost-accruals.service";
import { accrualsWorkbook } from "./cost-export";
import { CostImportsService } from "./cost-imports.service";
import { assertReportActive } from "./source/cost-source";

/** The upload limit. A month of ME2N for eleven units is a few thousand rows. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * M2 — SAP ingestion, the unmatched queue and the year-end accruals
 * (R14, R15, R18).
 *
 * RULE (CAPEX-01 §10): importing writes to every unit in the file at once,
 * which is exactly what a unit-scoped account must not do on its own — so the
 * three roles that own the money screens import, and nobody else. Allocating
 * is different: an engineer works the queue for their own projects, and the
 * row policy is what stops them putting a row anywhere else (migration 0011).
 *
 * Nothing here decides which rows a caller can see. The policies do, and a
 * batch in a unit the caller may not read answers 404 (ADR-0010).
 */
@ApiTags("cost")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("cost")
export class CostController {
  constructor(
    private readonly imports: CostImportsService,
    private readonly accruals: CostAccrualsService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * R14. The monthly extract, as a file, with a dry run by default —
   * ADR-0016's reasoning applies here too: reading what would happen is the
   * normal case and writing is the exception somebody asks for.
   */
  @Post("imports")
  @HttpCode(201)
  @Needs("sapImport", "WRITE")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Import a monthly SAP extract, or say what importing it would do" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "report", "period"],
      properties: {
        file: { type: "string", format: "binary" },
        // ADR-0036 §5: ME2N and KSB1 are listed so a client can name them,
        // and are refused with 422 errors.sapReportRetired.
        report: { type: "string", enum: [...SapReport.options], description: "CAPEX_LINES or FBL1N; ME2N and KSB1 are retired" },
        period: { type: "string", example: "2026-03" },
        dryRun: { type: "boolean", default: true },
      },
    },
  })
  @ApiZodResponse(201, ImportBatchResult, "The batch summary and the first fifty exceptions")
  @ApiZodError(400, "No file, or a report or period that is not valid")
  @ApiZodError(403, "A role that does not import")
  @ApiZodError(409, "That file has already been imported for that report")
  @ApiZodError(
    422,
    "A retired report (ME2N, KSB1: errors.sapReportRetired), a file that cannot be read, or a column the profile needs is missing",
  )
  async importExtract(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<ImportBatchResult> {
    const parsed = ImportRequest.safeParse(body ?? {});
    // ADR-0036 §5: a retired report is refused before the file is looked at.
    if (parsed.success) assertReportActive(parsed.data.report);
    if (!file?.buffer) throw AppError.badRequest("errors.costFileNeeded");
    if (!parsed.success) throw AppError.badRequest("errors.costImportNotValid");
    return this.imports.import(parsed.data, {
      fileName: file.originalname,
      content: file.buffer,
    });
  }

  /**
   * ADR-0036 §1. The capital lines straight from SAP administration's
   * connector, for one fiscal year and a range of posting periods, through
   * the same pipeline as the upload and with the same answer. Without
   * SAP_CONNECTOR_URL and SAP_CONNECTOR_KEY it answers 422
   * errors.costSourceNotConfigured. No nightly job yet; that is a later step.
   */
  @Post("imports/sap-connector")
  @HttpCode(201)
  @Needs("sapImport", "WRITE")
  @ApiOperation({ summary: "Import the SAP capital lines from the connector, or say what importing them would do" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["fiscalYear", "periodFrom", "periodTo"],
      properties: {
        fiscalYear: { type: "integer", minimum: 2000, maximum: 2100, example: 2026 },
        periodFrom: { type: "integer", minimum: 1, maximum: 16, example: 10 },
        periodTo: { type: "integer", minimum: 1, maximum: 16, example: 10 },
        dryRun: { type: "boolean", default: true },
      },
    },
  })
  @ApiZodResponse(201, ImportBatchResult, "The batch summary and the first fifty exceptions")
  @ApiZodError(400, "A fiscal year or a period range that is not valid")
  @ApiZodError(403, "A role that does not import")
  @ApiZodError(409, "The same lines have already been imported")
  @ApiZodError(422, "The connector is not configured, or its file lacks a column the profile needs")
  @ApiZodError(502, "The connector refused the call or did not answer")
  importFromConnector(@Body() body: unknown): Promise<ImportBatchResult> {
    const parsed = ConnectorImportRequest.safeParse(body ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.sapConnectorQueryNotValid");
    return this.imports.importFromConnector(parsed.data);
  }

  @Get("imports")
  @ApiOperation({ summary: "Every SAP import the caller may see, newest first" })
  @ApiZodResponse(200, ImportBatchList, "The batches, newest first")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(): Promise<ImportBatchList> {
    return this.imports.list();
  }

  @Get("imports/:id")
  @ApiOperation({ summary: "One import with its exceptions" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ImportBatchResult, "The batch and the first fifty exceptions")
  @ApiZodError(404, "No such import, or none the caller may see")
  detail(@Param("id") id: string): Promise<ImportBatchResult> {
    return this.imports.detail(id);
  }

  /** R14, S10: the queue, best suggestion first, nine at most on a row. */
  @Get("imports/:id/unmatched")
  @ApiOperation({ summary: "The rows that found no project, with what the system suggests" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 25 } })
  @ApiZodResponse(200, UnmatchedQueue, "The queue, largest amounts first")
  @ApiZodError(404, "No such import, or none the caller may see")
  unmatched(@Param("id") id: string, @Query("limit") limit?: string): Promise<UnmatchedQueue> {
    const parsed = z.coerce.number().int().min(1).max(200).safeParse(limit ?? 25);
    if (!parsed.success) throw AppError.badRequest("errors.badRequest");
    return this.imports.unmatched(id, parsed.data);
  }

  /**
   * R14. Put rows on a project and remember the decision.
   *
   * The role check is deliberately wider than the import's: CAPEX-01 §1 has
   * an engineer running ten to twenty projects, and the queue is their work.
   * Which projects they may put a row on is the row policy's answer, not this
   * decorator's.
   */
  @Post("imports/:id/allocate")
  @HttpCode(200)
  @NeedsAny(["sapImport", "WRITE"], ["forecastWarnings", "WRITE"])
  @ApiOperation({ summary: "Allocate unmatched rows to a project, and remember it" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(Allocation) as never })
  @ApiZodResponse(200, AllocationResult, "How many rows are left, and the next one")
  @ApiZodError(400, "The body is not a valid allocation")
  @ApiZodError(403, "A read-only account, or a project outside the caller's units")
  @ApiZodError(404, "No such import, project or row")
  allocate(@Param("id") id: string, @Body() body: unknown): Promise<AllocationResult> {
    const parsed = Allocation.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.allocationNotValid");
    return this.imports.allocate(id, parsed.data);
  }

  @Post("imports/:id/skip")
  @HttpCode(200)
  @NeedsAny(["sapImport", "WRITE"], ["forecastWarnings", "WRITE"])
  @ApiOperation({ summary: "Pass over rows without deciding; they stay in the batch" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SkipRequest) as never })
  @ApiZodResponse(200, AllocationResult, "How many rows are left, and the next one")
  @ApiZodError(400, "The body is not a valid list of rows")
  @ApiZodError(403, "A read-only account")
  @ApiZodError(404, "No such import, or no such row in it")
  skip(@Param("id") id: string, @Body() body: unknown): Promise<AllocationResult> {
    const parsed = SkipRequest.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.badRequest");
    return this.imports.skip(id, parsed.data.txnIds);
  }

  @Post("imports/:id/commit")
  @HttpCode(200)
  @Needs("sapImport", "WRITE")
  @ApiOperation({ summary: "Close the batch; what is still unmatched becomes an exception" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ImportBatchResult, "The committed batch and its exceptions")
  @ApiZodError(403, "A role that does not import")
  @ApiZodError(404, "No such import, or none the caller may see")
  commit(@Param("id") id: string): Promise<ImportBatchResult> {
    return this.imports.commit(id);
  }

  /** R18. Work certified and not yet invoiced, per project and cost centre. */
  @Get("accruals")
  @Needs("accruals", "READ")
  @ApiOperation({ summary: "The year-end accrual proposal" })
  @ApiQuery({ name: "year", required: true, schema: { type: "integer", example: 2026 } })
  @ApiQuery({ name: "orgUnitId", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, z.array(AccrualRow), "One row per certificate awaiting an invoice")
  @ApiZodError(400, "The year is missing or not a year")
  @ApiZodError(401, "No token, or a token that does not verify")
  accrualList(@Query() query: unknown): Promise<AccrualRow[]> {
    const parsed = AccrualQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.accrualQueryNotValid");
    return this.accruals.list(parsed.data);
  }

  /**
   * R18. The same proposal as a workbook, with the accrual column and the
   * totals as live formulas — the owner's requirement, and the reason
   * `cost-export.ts` never writes a calculated value.
   */
  @Get("accruals/export")
  @Needs("accruals", "READ")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "The accrual proposal as Excel, with live formulas" })
  @ApiQuery({ name: "year", required: true, schema: { type: "integer", example: 2026 } })
  @ApiQuery({ name: "orgUnitId", required: false, schema: { type: "string" } })
  @ApiZodError(400, "The year is missing or not a year")
  async accrualExport(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const parsed = AccrualQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.accrualQueryNotValid");
    const rows = await this.accruals.list(parsed.data);
    const file = await accrualsWorkbook(rows, parsed.data.year, this.i18n);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="ecapital-accruals-${parsed.data.year}.xlsx"`,
    );
    return new StreamableFile(file);
  }
}
