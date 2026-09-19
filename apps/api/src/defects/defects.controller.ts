import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  Defect,
  DefectBacklogRow,
  DefectCreate,
  DefectSource,
  DefectStatus,
  DefectUpdate,
  RiskBand,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { RolesGuard } from "../common/roles.guard";
import { DefectsService } from "./defects.service";

/**
 * A defect that hangs off no contract and no project still belongs to a unit,
 * so the body carries one (ADR-0017). Where a contract or a project is named
 * the unit comes from it and this is ignored.
 */
const DefectCreateBody = DefectCreate.extend({
  orgUnitId: z.string().min(1).nullable().default(null),
});

/** A filter repeated in the query string comes back as an array either way. */
const many = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item)]).optional().transform((value) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  );

const DefectListQuery = z.object({
  unit: many(z.string()),
  contract: z.string().nullish().transform((v) => v ?? null),
  project: z.string().nullish().transform((v) => v ?? null),
  status: many(DefectStatus),
  riskBand: many(RiskBand),
  source: many(DefectSource),
});

const BacklogQuery = z.object({ unit: many(z.string()) });

/**
 * M1 — the defect log (R12, R35). Έλλειψη, plural Ελλείψεις.
 *
 * These routes sit at the top level rather than under a contract, because a
 * defect is not always a contract's: a technician's inspection finds one in a
 * plant room that belongs to no project at all (CAPEX-01 §2, §8).
 *
 * Nothing here decides who may see or write a defect. The row policies do
 * (ADR-0010) — including the one narrower rule, that a technician may raise
 * and work an INSPECTION or WORK_ORDER defect but not a HANDOVER one, which
 * is a policy in migration 0006 and not a role check here, because it is a
 * rule about which rows exist for whom (ADR-0017).
 */
@ApiTags("site log")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("defects")
export class DefectsController {
  constructor(private readonly defects: DefectsService) {}

  @Get()
  @ApiOperation({ summary: "The defects the caller may see, newest first, filtered" })
  @ApiQuery({ name: "unit", required: false, description: "Org unit id; repeat for several." })
  @ApiQuery({ name: "contract", required: false })
  @ApiQuery({ name: "project", required: false })
  @ApiQuery({ name: "status", required: false, description: "OPEN, IN_PROGRESS or CLOSED." })
  @ApiQuery({ name: "riskBand", required: false, description: "HIGH, SIGNIFICANT, MODERATE or LOW." })
  @ApiQuery({ name: "source", required: false })
  @ApiZodResponse(200, z.array(Defect), "The matching defects, newest first")
  @ApiZodError(400, "The filters are not usable")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(@Query() query: unknown): Promise<Defect[]> {
    const parsed = DefectListQuery.safeParse(query);
    if (!parsed.success) throw AppError.badRequest("errors.defectQueryNotValid");
    return this.defects.list(parsed.data);
  }

  /**
   * R35. Declared before `:id` so that `/defects/backlog` is a report and not
   * a defect whose id happens to read "backlog".
   */
  @Get("backlog")
  @ApiOperation({ summary: "The costed, risk-banded maintenance backlog, by unit" })
  @ApiQuery({ name: "unit", required: false, description: "Org unit id; repeat for several." })
  @ApiZodResponse(200, z.array(DefectBacklogRow), "One row per unit per band, worst band first")
  @ApiZodError(400, "The filters are not usable")
  @ApiZodError(401, "No token, or a token that does not verify")
  backlog(@Query() query: unknown): Promise<DefectBacklogRow[]> {
    const parsed = BacklogQuery.safeParse(query);
    if (!parsed.success) throw AppError.badRequest("errors.defectQueryNotValid");
    return this.defects.backlog(parsed.data.unit);
  }

  @Get(":id")
  @ApiOperation({ summary: "One defect" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, Defect, "The defect")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such defect, or none the caller may see")
  detail(@Param("id") id: string): Promise<Defect> {
    return this.defects.detail(id);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Record a defect; a handover defect takes its due date from the contract" })
  @ApiBody({ schema: jsonSchema(DefectCreateBody) as never })
  @ApiZodResponse(201, Defect, "The defect as stored, OPEN, raised by the caller")
  @ApiZodError(400, "The body is not a valid defect, or names no unit and no parent")
  @ApiZodError(403, "A read-only account, or a role that may not raise this kind of defect")
  @ApiZodError(404, "No such contract or project, or none the caller may see")
  create(@Body() body: unknown): Promise<Defect> {
    const parsed = DefectCreateBody.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.defectNotValid");
    return this.defects.create(parsed.data);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change a defect; closing it records who and when" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(DefectUpdate) as never })
  @ApiZodResponse(200, Defect, "The defect after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A read-only account, or a role that may not write this defect")
  @ApiZodError(404, "No such defect, or none the caller may see")
  @ApiZodError(422, "Funded with no project to fund it from")
  update(@Param("id") id: string, @Body() body: unknown): Promise<Defect> {
    const parsed = DefectUpdate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.defectNotValid");
    return this.defects.update(id, sentKeysOnly(parsed.data, body));
  }
}
