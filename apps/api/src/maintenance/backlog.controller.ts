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
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import {
  BacklogCreate,
  BacklogItem,
  BacklogListQuery,
  BacklogPatch,
  BacklogStatus,
  BacklogSummaryRow,
  BacklogToProject,
} from "@ecapital/shared";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { Roles, RolesGuard } from "../common/roles.guard";
import { BacklogService } from "./backlog.service";
import { backlogWorkbook } from "./maintenance-export";
import { booleanParam, manyOf } from "./work-orders.controller";

const ListQuery = BacklogListQuery.extend({
  status: manyOf(BacklogStatus),
  autoDrafted: booleanParam,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const BacklogList = z.object({ items: z.array(BacklogItem), total: z.number().int() });
type BacklogList = z.infer<typeof BacklogList>;

const UnitQuery = z.object({ orgUnitId: z.string().min(1).optional() });

const ToProjectResult = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  item: BacklogItem,
});
type ToProjectResult = z.infer<typeof ToProjectResult>;

/**
 * M5 — Εκκρεμότητες συντήρησης, the maintenance backlog (R35, R36;
 * ADR-0031 §7–8). Not «Ελλείψεις»: those are a capital contract's handover
 * snags and stay where they are.
 *
 * The engineer, the head of estates and the administrator keep it; «Σε έργο»
 * is the head of estates' and the administrator's, because it drafts a
 * capital project. Row policies first (`can_manage_backlog`,
 * `can_manage_project`), `@Roles` second.
 *
 * The paths are a contract with the web app. None of them is renamed.
 */
@ApiTags("maintenance backlog")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("backlog")
export class BacklogController {
  constructor(
    private readonly backlog: BacklogService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @ApiOperation({ summary: "The backlog items the caller may see, worst band first" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiQuery({ name: "riskBand", required: false })
  @ApiQuery({ name: "status", required: false, description: "Repeated or comma-separated" })
  @ApiQuery({ name: "kind", required: false })
  @ApiQuery({ name: "assetId", required: false })
  @ApiQuery({ name: "autoDrafted", required: false, schema: { type: "boolean" } })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "sort", required: false })
  @ApiQuery({ name: "dir", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiZodResponse(200, BacklogList, "The page")
  @ApiZodError(400, "The filters, the sort or the page are not usable")
  list(@Query() query: unknown): Promise<BacklogList> {
    const parsed = ListQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.backlogQueryNotValid");
    return this.backlog.list(parsed.data);
  }

  /** Declared before `:id` so that `/backlog/summary` is a report, not an item. */
  @Get("summary")
  @ApiOperation({ summary: "S21's totals: OPEN and FUNDED by unit and band" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiZodResponse(200, z.array(BacklogSummaryRow), "One row per unit per band")
  summary(@Query() query: unknown): Promise<BacklogSummaryRow[]> {
    const parsed = UnitQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.backlogQueryNotValid");
    return this.backlog.summary(parsed.data.orgUnitId ?? null);
  }

  /** One sheet of items, one of COUNTIFS and SUMIFS over it — live formulas. */
  @Get("export.xlsx")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "The backlog as Excel, with the unit × band summary as live formulas" })
  @ApiQuery({ name: "orgUnitId", required: false })
  async export(
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const parsed = UnitQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.backlogQueryNotValid");
    const rows = await this.backlog.exportRows(parsed.data.orgUnitId ?? null);
    const file = await backlogWorkbook(rows, this.i18n);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader("Content-Disposition", 'attachment; filename="ecapital-backlog.xlsx"');
    return new StreamableFile(file);
  }

  @Post()
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Add an item to the backlog" })
  @ApiBody({ schema: jsonSchema(BacklogCreate) as never })
  @ApiZodResponse(201, BacklogItem, "The item as stored")
  @ApiZodError(400, "Not a valid item, no unit, or an asset and unit that disagree")
  @ApiZodError(403, "A role that does not keep the backlog, or a unit the caller may not write")
  @ApiZodError(404, "An asset, catalogue line or order that is not this caller's")
  create(@Body() body: unknown): Promise<BacklogItem> {
    const parsed = BacklogCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.backlogItemNotValid");
    return this.backlog.create(parsed.data);
  }

  @Patch(":id")
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Change an item: band, cost, status, the project funding it" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(BacklogPatch) as never })
  @ApiZodResponse(200, BacklogItem, "The item after the change")
  @ApiZodError(400, "Not a valid change")
  @ApiZodError(403, "A role that does not keep the backlog, or a unit the caller may not write")
  @ApiZodError(404, "No such item, or a project that is not this caller's")
  @ApiZodError(422, "FUNDED with no project to fund it")
  update(@Param("id") id: string, @Body() body: unknown): Promise<BacklogItem> {
    const parsed = BacklogPatch.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.backlogItemNotValid");
    return this.backlog.update(id, sentKeysOnly(parsed.data, body));
  }

  /** «Σε έργο»: a project at IDEA and the item FUNDED against it, in one transaction. */
  @Post(":id/to-project")
  @HttpCode(201)
  @Roles("admin", "estates_head")
  @ApiOperation({ summary: "Draft a project at the Idea phase from the item and fund the item" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(BacklogToProject) as never })
  @ApiZodResponse(201, ToProjectResult, "The new project's id and code, and the funded item")
  @ApiZodError(400, "Not a valid title")
  @ApiZodError(403, "A role that does not draft projects, or a unit the caller may not write")
  @ApiZodError(404, "No such item, or none the caller may see")
  @ApiZodError(409, "The item is already funded, done or dropped")
  toProject(@Param("id") id: string, @Body() body: unknown): Promise<ToProjectResult> {
    const parsed = BacklogToProject.safeParse(body ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.backlogItemNotValid");
    return this.backlog.toProject(id, parsed.data);
  }
}
