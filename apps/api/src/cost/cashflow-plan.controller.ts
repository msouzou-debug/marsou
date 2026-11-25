import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
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
import { CashflowPlan, CashflowPlanImportResult, CashflowPlanWrite } from "@ecapital/shared";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { Needs } from "../permissions/needs.guard";
import { CashflowPlanService } from "./cashflow-plan.service";
import { CashflowQuery } from "./cost-contracts";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const IMPORT_BODY = {
  type: "object",
  required: ["file"],
  properties: { file: { type: "string", format: "binary" } },
};

/**
 * ADR-0037 — a project's cash-flow plan by month, and its Excel round trip.
 *
 * RULE (ADR-0037, ADR-0014): the plan is written by whoever writes the
 * project's budget lines — `budgetLines` WRITE, finance and the
 * administrator by default. 0028's row policy says the same thing. Reading
 * it is everyone who reads the project (ADR-0010: otherwise 404).
 */
@ApiTags("cost")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class CashflowPlanController {
  constructor(
    private readonly plans: CashflowPlanService,
    private readonly i18n: I18nService,
  ) {}

  @Get("projects/:id/cost/cashflow-plan")
  @ApiOperation({ summary: "The project's cash-flow plan by month, its total and the gap to the approved budget" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, CashflowPlan, "The plan; no months means the cash flow uses the budget spread")
  @ApiZodError(404, "No such project, or none the caller may see")
  plan(@Param("id") id: string): Promise<CashflowPlan> {
    return this.plans.planOf(id);
  }

  @Put("projects/:id/cost/cashflow-plan")
  @HttpCode(200)
  @Needs("budgetLines", "WRITE")
  @ApiOperation({ summary: "Replace the plan, or write some of its months" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(CashflowPlanWrite) as never })
  @ApiZodResponse(200, CashflowPlan, "The plan after the change")
  @ApiZodError(400, "Not a valid plan: a month that is not YYYY-MM, or a negative amount")
  @ApiZodError(403, "A role that does not write the budget, or a read-only account")
  @ApiZodError(404, "No such project, or none the caller may see")
  @ApiZodError(422, "The same month twice")
  write(@Param("id") id: string, @Body() body: unknown): Promise<CashflowPlan> {
    const parsed = CashflowPlanWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.cashflowPlanNotValid");
    return this.plans.write(id, parsed.data);
  }

  /** The plan as .xlsx: months as rows, a live SUM and a live difference. */
  @Get("projects/:id/cost/cashflow-plan/template.xlsx")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "The plan as an Excel template, with the total and the difference as formulas" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "from", required: false, schema: { type: "string", example: "2026-01" } })
  @ApiQuery({ name: "to", required: false, schema: { type: "string", example: "2027-12" } })
  @ApiZodError(400, "The window is not two periods, or ends before it starts")
  @ApiZodError(404, "No such project, or none the caller may see")
  async template(
    @Param("id") id: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const parsed = CashflowQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.cashflowRangeNotValid");
    const { code, file } = await this.plans.template(id, parsed.data, this.i18n);
    response.setHeader("Content-Type", XLSX);
    response.setHeader("Content-Disposition", `attachment; filename="${code}-cashflow-plan.xlsx"`);
    return new StreamableFile(file);
  }

  /**
   * RULE (owner): all or nothing. A file with any bad row is answered with
   * every bad row and nothing is saved; a clean file replaces the plan.
   */
  @Post("projects/:id/cost/cashflow-plan/import")
  @HttpCode(200)
  @Needs("budgetLines", "WRITE")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Replace the plan from the Excel template, or say which rows to fix" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: IMPORT_BODY })
  @ApiZodResponse(200, CashflowPlanImportResult, "Saved, or the rows to fix and nothing saved")
  @ApiZodError(400, "No file, or a file that is not an .xlsx workbook")
  @ApiZodError(403, "A role that does not write the budget, or a read-only account")
  @ApiZodError(404, "No such project, or none the caller may see")
  importPlan(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<CashflowPlanImportResult> {
    if (!file?.buffer?.length) throw AppError.badRequest("errors.cashflowPlanFileNeeded");
    return this.plans.importPlan(id, file.buffer);
  }
}
