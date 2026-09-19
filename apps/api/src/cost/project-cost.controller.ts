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
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CashflowRow, CostWarning, ForecastInputs, ProjectCost } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { BudgetLineList, BudgetLinesWrite, CashflowQuery } from "./cost-contracts";
import { projectCostWorkbook } from "./cost-export";
import { CostWarningsService } from "./cost-warnings.service";
import { ProjectCostService } from "./project-cost.service";

/**
 * M2 — the four ledgers on a project, the forecast inputs, the budget lines,
 * the warnings and the cash-flow profile (R13, R16, R17, R31).
 *
 * Two role rules are stated here and nowhere else in this file:
 *
 *  - the forecast inputs belong to whoever runs the project (R16);
 *  - the budget lines belong to finance, because after a project is approved
 *    the budget is finance's (ADR-0014, owner decision 19/09/2026). The row
 *    policy says the same thing, so a script cannot do what the route
 *    refuses.
 *
 * Everything else is the row policies' business (ADR-0010): a project the
 * caller may not see answers 404.
 */
@ApiTags("cost")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class ProjectCostController {
  constructor(
    private readonly cost: ProjectCostService,
    private readonly warnings: CostWarningsService,
    private readonly i18n: I18nService,
  ) {}

  @Get("projects/:id/cost")
  @ApiOperation({ summary: "The four ledgers, the categories and the live warnings" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ProjectCost, "Everything the project cost screen needs")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such project, or none the caller may see")
  cost_(@Param("id") id: string): Promise<ProjectCost> {
    return this.cost.costOf(id);
  }

  /** R16: the contingency and the weight pending variations carry. */
  @Put("projects/:id/cost/forecast-inputs")
  @HttpCode(200)
  @Roles("project_engineer", "estates_head", "admin")
  @ApiOperation({ summary: "Set the contingency and the pending-variation weight" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ForecastInputs) as never })
  @ApiZodResponse(200, ProjectCost, "The ledgers after the change")
  @ApiZodError(400, "The body is not a valid set of inputs")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  setForecastInputs(@Param("id") id: string, @Body() body: unknown): Promise<ProjectCost> {
    const parsed = ForecastInputs.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.forecastInputsNotValid");
    return this.cost.setForecastInputs(id, parsed.data);
  }

  @Get("projects/:id/budget-lines")
  @ApiOperation({ summary: "The approved budget by year and vintage" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, BudgetLineList, "The budget lines, oldest vintage first")
  @ApiZodError(404, "No such project, or none the caller may see")
  budgetLines(@Param("id") id: string): Promise<BudgetLineList> {
    return this.cost.budgetLines(id);
  }

  /**
   * RULE (ADR-0014): finance and the administrator, and nobody else. The
   * lines of one vintage are replaced whole; the imported vintages are left
   * exactly as the capex plan wrote them.
   */
  @Put("projects/:id/budget-lines")
  @HttpCode(200)
  @Roles("finance", "admin")
  @ApiOperation({ summary: "Replace the approved budget lines of one vintage" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(BudgetLinesWrite) as never })
  @ApiZodResponse(200, BudgetLineList, "The budget lines after the change")
  @ApiZodError(400, "The body is not a valid set of lines")
  @ApiZodError(403, "Not finance, or a read-only account")
  @ApiZodError(404, "No such project, or none the caller may see")
  @ApiZodError(422, "Two lines carry the same year and type")
  replaceBudgetLines(@Param("id") id: string, @Body() body: unknown): Promise<BudgetLineList> {
    const parsed = BudgetLinesWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.budgetLinesNotValid");
    return this.cost.replaceBudgetLines(id, parsed.data);
  }

  /**
   * R31. Dismissing is a decision with a name on it: it is written into the
   * row, so it survives the next page load, and into the audit log by the
   * trigger. A rule that fires again at a different figure comes back as a
   * new row beside the dismissed one.
   */
  @Post("projects/:id/cost/warnings/:wid/dismiss")
  @HttpCode(200)
  @Roles("project_engineer", "estates_head", "finance", "admin")
  @ApiOperation({ summary: "Dismiss a cost warning; it stays on the record" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "wid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, CostWarning, "The warning, with who dismissed it and when")
  @ApiZodError(403, "A read-only account")
  @ApiZodError(404, "No such warning on this project")
  dismissWarning(@Param("id") id: string, @Param("wid") wid: string): Promise<CostWarning> {
    return this.warnings.dismiss(id, wid);
  }

  /** R17: planned against actual, by month, with both running totals. */
  @Get("projects/:id/cost/cashflow")
  @ApiOperation({ summary: "The project's cash-flow profile by month" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "from", required: false, schema: { type: "string", example: "2026-01" } })
  @ApiQuery({ name: "to", required: false, schema: { type: "string", example: "2026-12" } })
  @ApiZodResponse(200, z.array(CashflowRow), "One row per month in the window")
  @ApiZodError(400, "The window is not two periods, or ends before it starts")
  @ApiZodError(404, "No such project, or none the caller may see")
  cashflow(@Param("id") id: string, @Query() query: unknown): Promise<CashflowRow[]> {
    const parsed = CashflowQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.cashflowRangeNotValid");
    return this.cost.cashflow(id, parsed.data);
  }

  /** R17: the same profile, summed over every project of one unit. */
  @Get("org-units/:id/cost/cashflow")
  @ApiOperation({ summary: "The unit's cash-flow profile by month" })
  @ApiParam({ name: "id", schema: { type: "string" } })
  @ApiQuery({ name: "from", required: false, schema: { type: "string", example: "2026-01" } })
  @ApiQuery({ name: "to", required: false, schema: { type: "string", example: "2026-12" } })
  @ApiZodResponse(200, z.array(CashflowRow), "One row per month in the window")
  @ApiZodError(400, "The window is not two periods, or ends before it starts")
  @ApiZodError(404, "No such unit, or none the caller may see")
  unitCashflow(@Param("id") id: string, @Query() query: unknown): Promise<CashflowRow[]> {
    const parsed = CashflowQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.cashflowRangeNotValid");
    return this.cost.unitCashflow(id, parsed.data);
  }

  /** R13: the category table as Excel, with «Απόκλιση» and the totals live. */
  @Get("projects/:id/cost/export")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "The project's cost by category as Excel, with live formulas" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodError(404, "No such project, or none the caller may see")
  async exportCost(
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const project = await this.cost.loadProject(id);
    const cost = await this.cost.costOf(id);
    const file = await projectCostWorkbook(
      { code: project.code, titleEl: project.titleEl, categories: cost.categories },
      this.i18n,
    );
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader("Content-Disposition", `attachment; filename="${project.code}-cost.xlsx"`);
    return new StreamableFile(file);
  }
}
