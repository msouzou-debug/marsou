import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  ApprovalDecisionWrite,
  AuditEntry,
  IcraSubmission,
  PermitListQuery,
  PermitListRow,
  PermitStatus,
  PermitSystem,
  PermitTransition,
  ShutdownPermit,
  ShutdownPermitDraft,
  AreaType,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { Roles, RolesGuard } from "../common/roles.guard";
import { PermitsService } from "./permits.service";

/** A filter repeated in the query string comes back as an array either way. */
const many = <T extends z.ZodType>(item: T) =>
  z
    .union([item, z.array(item)])
    .optional()
    .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]));

const ListQuery = z.object({
  orgUnitId: z.string().optional(),
  status: many(PermitStatus),
  system: PermitSystem.optional(),
  areaType: AreaType.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * S11 saves the wizard a step at a time, so every draft field is optional on
 * the way in — the create call happens when the requester leaves step 1, with
 * the areas and the window still unanswered (ADR-0026).
 */
const PermitPatch = ShutdownPermitDraft.partial();

const PermitPage = z.object({ items: z.array(PermitListRow), total: z.number().int() });

/**
 * M3 — Διακοπές και άδειες εργασίας (R19, R21–R24). CAPEX-01 §6.
 *
 * Nothing here decides who may see a permit; the row policies do (ADR-0010),
 * including §9's narrow one — a clinical approver reads only the permits with
 * a line assigned to them or touching an area they own. What the role guard
 * does say is who may *raise* one: the three roles that run the project
 * register, which is what a shutdown hangs off.
 */
@ApiTags("permits")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("permits")
export class PermitsController {
  constructor(private readonly permits: PermitsService) {}

  @Get()
  @ApiOperation({ summary: "The permits the caller may see, newest window first" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiQuery({ name: "status", required: false, description: "Repeat for several." })
  @ApiQuery({ name: "system", required: false })
  @ApiQuery({ name: "areaType", required: false })
  @ApiQuery({ name: "from", required: false, description: "ISO date; permits ending on or after it." })
  @ApiQuery({ name: "to", required: false, description: "ISO date; permits starting on or before it." })
  @ApiQuery({ name: "q", required: false, description: "Matches the title or the reference." })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiZodResponse(200, PermitPage, "One page of permits and the total behind it")
  @ApiZodError(400, "The query is not valid")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(@Query() query: unknown): Promise<{ items: PermitListRow[]; total: number }> {
    const parsed = ListQuery.safeParse(query);
    if (!parsed.success) throw AppError.badRequest("errors.permitQueryNotValid");
    return this.permits.list(
      PermitListQuery.parse({
        ...parsed.data,
        status: parsed.data.status.length ? parsed.data.status : undefined,
      }),
    );
  }

  @Post()
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Raise a shutdown request; the API works out the indirect impact" })
  @ApiBody({ schema: jsonSchema(ShutdownPermitDraft) as never })
  @ApiZodResponse(201, ShutdownPermit, "The permit as stored, DRAFT, with its affected areas")
  @ApiZodError(400, "The body is not a valid shutdown request")
  @ApiZodError(403, "A read-only account, or a role that does not raise permits")
  @ApiZodError(404, "An area the caller cannot see")
  @ApiZodError(422, "The window runs backwards, the areas are in different units, or the unit cannot be worked out")
  create(@Body() body: unknown): Promise<ShutdownPermit> {
    const parsed = ShutdownPermitDraft.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.permitNotValid");
    return this.permits.create(parsed.data, new Date());
  }

  @Get(":id")
  @ApiOperation({ summary: "One permit with its areas, its ICRA, its ILSM and its approvals" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ShutdownPermit, "The permit")
  @ApiZodError(404, "No such permit, or none the caller may see")
  one(@Param("id") id: string): Promise<ShutdownPermit> {
    return this.permits.one(id, new Date());
  }

  /**
   * R42, the same shape `GET /projects/:id` carries its own trail in: the
   * permit's row and every approval line that ever belonged to it, newest
   * first. S13's timeline is derived from the lifecycle fields today; this is
   * what it moves to when it wants who and when as well as what.
   */
  @Get(":id/audit")
  @ApiOperation({ summary: "The permit's own history, newest first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(AuditEntry), "The trail, at most fifty lines")
  @ApiZodError(404, "No such permit, or none the caller may see")
  audit(@Param("id") id: string): Promise<AuditEntry[]> {
    return this.permits.auditOf(id);
  }

  /** RULE: only while DRAFT — which is also where a RETURNED permit lands. */
  @Patch(":id")
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Change a draft shutdown request" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(PermitPatch) as never })
  @ApiZodResponse(200, ShutdownPermit, "The permit after the change")
  @ApiZodError(400, "The body is not a valid shutdown request")
  @ApiZodError(403, "A read-only account, or a role that does not raise permits")
  @ApiZodError(404, "No such permit")
  @ApiZodError(422, "The permit has been submitted and is not a draft any more")
  patch(@Param("id") id: string, @Body() body: unknown): Promise<ShutdownPermit> {
    const parsed = PermitPatch.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.permitNotValid");
    // A PATCH touches what it names and nothing else. Without this, the
    // contract's own defaults would arrive as an empty `affectedAreaIds` on
    // every save and quietly unpick every area the wizard had chosen.
    return this.permits.patch(id, sentKeysOnly(parsed.data, body), new Date());
  }

  @Post(":id/icra")
  @HttpCode(200)
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Run the ICRA wizard over this permit and store the class" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(IcraSubmission) as never })
  @ApiZodResponse(200, ShutdownPermit, "The permit with its ICRA result and controls")
  @ApiZodError(400, "The body is not a valid ICRA submission")
  @ApiZodError(404, "No such permit")
  @ApiZodError(422, "Class II for construction or renovation, or a control nobody acknowledged")
  icra(@Param("id") id: string, @Body() body: unknown): Promise<ShutdownPermit> {
    const parsed = IcraSubmission.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.icraInputNotValid");
    return this.permits.submitIcra(id, parsed.data, new Date());
  }

  /**
   * SUBMITTED, ACTIVE, CLOSED, REJECTED. There is no route to CLINICAL_REVIEW
   * or APPROVED: those are what the approvals do (§6.4), and BREACH is what
   * the clock does (§6.5).
   */
  @Post(":id/transition")
  @HttpCode(200)
  @ApiOperation({ summary: "Submit, start, close or reject a permit" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(PermitTransition) as never })
  @ApiZodResponse(200, ShutdownPermit, "The permit in its new state")
  @ApiZodError(400, "The body is not a valid transition")
  @ApiZodError(403, "Not the person who signs the clinical acceptance, or a read-only account")
  @ApiZodError(404, "No such permit")
  @ApiZodError(422, "Not a move this permit can make from where it is")
  transition(@Param("id") id: string, @Body() body: unknown): Promise<ShutdownPermit> {
    const parsed = PermitTransition.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.permitTransitionNotValid");
    return this.permits.transition(id, parsed.data, new Date());
  }

  @Post(":id/approvals/:approvalId/decide")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve, return with comments, or reject one approval line" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "approvalId", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ApprovalDecisionWrite) as never })
  @ApiZodResponse(200, ShutdownPermit, "The permit after the decision")
  @ApiZodError(400, "The body is not a valid decision")
  @ApiZodError(403, "This line is waiting on somebody else")
  @ApiZodError(404, "No such permit or approval line")
  @ApiZodError(409, "The caller is the permit's own requester (ADR-0015's segregation, admin included)")
  @ApiZodError(422, "The line has been decided already, or the permit is not in review")
  decide(
    @Param("id") id: string,
    @Param("approvalId") approvalId: string,
    @Body() body: unknown,
  ): Promise<ShutdownPermit> {
    const parsed = ApprovalDecisionWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.permitDecisionNotValid");
    return this.permits.decide(id, approvalId, parsed.data, new Date());
  }
}
