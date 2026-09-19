import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AffectedArea, PermitSystem, SystemFeed } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { SystemFeedsService } from "./system-feeds.service";

const SystemFeedCreate = z.object({
  orgUnitId: z.string().min(1),
  system: PermitSystem,
  sourceAreaId: z.string().uuid().nullable().default(null),
  servesAreaIds: z.array(z.string().uuid()).default([]),
  labelEl: z.string().min(2).max(200),
});

const SystemFeedUpdate = SystemFeedCreate.omit({ orgUnitId: true }).partial();

/** A list in a query string, comma-separated, as the web app sends it. */
const commaList = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item));

const ImpactQuery = z.object({
  orgUnitId: z.string().min(1),
  systems: commaList(PermitSystem),
  areaIds: commaList(z.string().uuid()),
});

/**
 * M3 — system feeds and the indirect-impact answer (R19, CAPEX-01 §6.1).
 *
 * The feeds are estate facts: whoever runs the technical services of a unit
 * records what its risers serve, and everyone who may read the unit may read
 * them. That is a row policy in migration 0015 and not a check here
 * (ADR-0010); a unit the caller cannot see answers with nothing.
 *
 * `GET /areas/impact` is the route S11 calls as the engineer ticks systems
 * and picks areas. It stores nothing — a request is a question about what
 * would be affected, and the answer is written down when the permit is.
 */
@ApiTags("permits")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class SystemFeedsController {
  constructor(private readonly feeds: SystemFeedsService) {}

  @Get("system-feeds")
  @ApiOperation({ summary: "The system feeds of a unit — what each riser and board serves" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiZodResponse(200, z.array(SystemFeed), "The feeds the caller may see")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(@Query("orgUnitId") orgUnitId?: string): Promise<SystemFeed[]> {
    return this.feeds.list(orgUnitId ?? null);
  }

  @Post("system-feeds")
  @HttpCode(201)
  @ApiOperation({ summary: "Record what a system serves from a source area" })
  @ApiBody({ schema: jsonSchema(SystemFeedCreate) as never })
  @ApiZodResponse(201, SystemFeed, "The feed as stored")
  @ApiZodError(400, "The body is not a valid system feed")
  @ApiZodError(403, "A role that does not keep the estate's feeds")
  @ApiZodError(404, "An area that is not in this unit")
  create(@Body() body: unknown): Promise<SystemFeed> {
    const parsed = SystemFeedCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.systemFeedNotValid");
    return this.feeds.create(parsed.data);
  }

  @Patch("system-feeds/:id")
  @ApiOperation({ summary: "Change a system feed; its unit does not move" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SystemFeedUpdate) as never })
  @ApiZodResponse(200, SystemFeed, "The feed after the change")
  @ApiZodError(400, "The body is not a valid system feed")
  @ApiZodError(403, "A role that does not keep the estate's feeds")
  @ApiZodError(404, "No such feed, or an area that is not in its unit")
  update(@Param("id") id: string, @Body() body: unknown): Promise<SystemFeed> {
    const parsed = SystemFeedUpdate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.systemFeedNotValid");
    return this.feeds.update(id, parsed.data);
  }

  @Delete("system-feeds/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a system feed" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodError(403, "A role that does not keep the estate's feeds")
  @ApiZodError(404, "No such feed")
  remove(@Param("id") id: string): Promise<void> {
    return this.feeds.remove(id);
  }

  /**
   * RULE (§6.1): the reply carries a DIRECT row for every area the engineer
   * picked and an INDIRECT row for every area a matching feed serves, each
   * with its risk group, its building and its floor — which is what the
   * wizard needs to warn before anybody has committed to anything.
   */
  @Get("areas/impact")
  @ApiOperation({ summary: "What a shutdown of these systems in these areas would affect" })
  @ApiQuery({ name: "orgUnitId", required: true })
  @ApiQuery({ name: "systems", required: false, description: "Comma-separated, e.g. MEDICAL_GAS,HVAC" })
  @ApiQuery({ name: "areaIds", required: true, description: "Comma-separated area ids" })
  @ApiZodResponse(200, z.array(AffectedArea), "The direct areas first, then the indirect ones")
  @ApiZodError(400, "The query is not valid, or names no area")
  @ApiZodError(404, "An area the caller cannot see")
  impact(@Query() query: unknown): Promise<AffectedArea[]> {
    const parsed = ImpactQuery.safeParse(query);
    if (!parsed.success) throw AppError.badRequest("errors.impactQueryNotValid");
    return this.feeds.impact(parsed.data.orgUnitId, parsed.data.systems, parsed.data.areaIds);
  }
}
