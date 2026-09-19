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
import { Allocation, AccrualRow, UnmatchedQueue } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import {
  AccrualQuery,
  AllocationResult,
  ImportBatchList,
  ImportBatchResult,
  ImportRequest,
  SkipRequest,
} from "./cost-contracts";
import { CostAccrualsService } from "./cost-accruals.service";
import { accrualsWorkbook } from "./cost-export";
import { CostImportsService } from "./cost-imports.service";

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
  @Roles("finance", "estates_head", "admin")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Import a monthly SAP extract, or say what importing it would do" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file", "report", "period"],
      properties: {
        file: { type: "string", format: "binary" },
        report: { type: "string", enum: ["ME2N", "KSB1", "FBL1N"] },
        period: { type: "string", example: "2026-03" },
        dryRun: { type: "boolean", default: true },
      },
    },
  })
  @ApiZodResponse(201, ImportBatchResult, "The batch summary and the first fifty exceptions")
  @ApiZodError(400, "No file, or a report or period that is not valid")
  @ApiZodError(403, "A role that does not import")
  @ApiZodError(409, "That file has already been imported for that report")
  @ApiZodError(422, "The file cannot be read, or a column the profile needs is missing")
  async importExtract(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<ImportBatchResult> {
    if (!file?.buffer) throw AppError.badRequest("errors.costFileNeeded");
    const parsed = ImportRequest.safeParse(body ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.costImportNotValid");
    return this.imports.import(parsed.data, {
      fileName: file.originalname,
      content: file.buffer,
    });
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
  @Roles("finance", "estates_head", "project_engineer", "admin")
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
  @Roles("finance", "estates_head", "project_engineer", "admin")
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
  @Roles("finance", "estates_head", "admin")
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
