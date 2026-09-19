import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  Issue,
  IssueWrite,
  Milestone,
  MilestoneWrite,
  ProjectCreate,
  ProjectDetail,
  ProjectList,
  ProjectPhaseChange,
  ProjectUpdate,
  Risk,
  RiskWrite,
} from "@ecapital/shared";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { parseProjectListQuery } from "./project-query";
import { ProjectsService } from "./projects.service";

/**
 * M1 — the project register. R04 (phases and gates), R05 (the business-case
 * fields carried from the capex plan), R06 (milestones), R07 (risks and
 * issues), R42 (every mutation audited).
 *
 * Nothing in this controller decides who may do what. The row policies do
 * (ADR-0010); a project the caller may not see answers 404 and a write they
 * may not make answers 403.
 */
@ApiTags("projects")
@ApiBearerAuth()
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: "The projects the caller may see, filtered, sorted and paged" })
  @ApiQuery({ name: "unit", required: false, isArray: true, schema: { type: "array", items: { type: "string" } }, description: "Org unit ids; repeat the parameter for several" })
  @ApiQuery({ name: "phase", required: false, isArray: true, schema: { type: "array", items: { type: "string" } }, description: "One of the nine phases; repeat for several" })
  @ApiQuery({ name: "category", required: false, isArray: true, schema: { type: "array", items: { type: "string" } } })
  @ApiQuery({ name: "rag", required: false, isArray: true, schema: { type: "array", items: { type: "string" } } })
  @ApiQuery({ name: "q", required: false, schema: { type: "string" }, description: "Matches the code and the Greek title, ignoring case and accents" })
  @ApiQuery({ name: "sort", required: false, schema: { type: "string", default: "approvedBudget" } })
  @ApiQuery({ name: "dir", required: false, schema: { type: "string", default: "desc" } })
  @ApiQuery({ name: "page", required: false, schema: { type: "integer", default: 1 } })
  @ApiQuery({ name: "pageSize", required: false, schema: { type: "integer", default: 50 } })
  @ApiZodResponse(200, ProjectList, "One page of projects, with the total behind it")
  @ApiZodError(400, "A filter, a sort key or a page number is not usable")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(@Query() query: unknown): Promise<ProjectList> {
    const parsed = parseProjectListQuery(query);
    if (!parsed.success) throw AppError.badRequest("errors.projectQueryNotValid");
    return this.projects.list(parsed.data);
  }

  @Get(":id")
  @ApiOperation({ summary: "One project with its milestones, risks, issues and history" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ProjectDetail, "Everything the project overview screen needs")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such project, or none the caller may see")
  detail(@Param("id") id: string): Promise<ProjectDetail> {
    return this.projects.detail(id);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Open a new project; the API allocates the code" })
  @ApiBody({ schema: jsonSchema(ProjectCreate) as never })
  @ApiZodResponse(201, ProjectDetail, "The project as stored, code included")
  @ApiZodError(400, "The body is not a valid project")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  create(@Body() body: unknown): Promise<ProjectDetail> {
    const parsed = ProjectCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.projectNotValid");
    return this.projects.create(parsed.data);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change the fields of a project" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ProjectUpdate) as never })
  @ApiZodResponse(200, ProjectDetail, "The project after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  update(@Param("id") id: string, @Body() body: unknown): Promise<ProjectDetail> {
    const parsed = ProjectUpdate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.projectNotValid");
    // A PATCH changes what it names. The contract's defaults would otherwise
    // add five nulls the caller never sent; see common/patch.ts.
    return this.projects.update(id, sentKeysOnly(parsed.data, body));
  }

  /**
   * R04. One step forward, with a reason, and not past an open gate. An
   * administrator may also move a project back — the rules are on
   * ProjectsService.changePhase.
   */
  @Post(":id/phase")
  @HttpCode(200)
  @ApiOperation({ summary: "Move the project to the next phase" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ProjectPhaseChange) as never })
  @ApiZodResponse(200, ProjectDetail, "The project in its new phase")
  @ApiZodError(400, "The body is not a valid phase change")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  @ApiZodError(422, "Not the next phase, or a gate milestone is still open")
  changePhase(@Param("id") id: string, @Body() body: unknown): Promise<ProjectDetail> {
    const parsed = ProjectPhaseChange.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.phaseChangeNotValid");
    return this.projects.changePhase(id, parsed.data);
  }

  @Post(":id/milestones")
  @HttpCode(201)
  @ApiOperation({ summary: "Add a milestone to the project" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(MilestoneWrite) as never })
  @ApiZodResponse(201, Milestone, "The milestone as stored")
  @ApiZodError(400, "The body is not a valid milestone")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  addMilestone(@Param("id") id: string, @Body() body: unknown): Promise<Milestone> {
    const parsed = MilestoneWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.milestoneNotValid");
    return this.projects.addMilestone(id, parsed.data);
  }

  @Patch(":id/milestones/:mid")
  @ApiOperation({ summary: "Change a milestone; the baseline date cannot move" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "mid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(MilestoneWrite) as never })
  @ApiZodResponse(200, Milestone, "The milestone after the change")
  @ApiZodError(400, "The body is not a valid milestone")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project or milestone")
  @ApiZodError(409, "An open shutdown permit on this project blocks the completion (R24, §6.6)")
  @ApiZodError(422, "The body asks to move the baseline date")
  updateMilestone(
    @Param("id") id: string,
    @Param("mid") mid: string,
    @Body() body: unknown,
  ): Promise<Milestone> {
    const parsed = MilestoneWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.milestoneNotValid");
    return this.projects.updateMilestone(id, mid, parsed.data);
  }

  @Post(":id/risks")
  @HttpCode(201)
  @ApiOperation({ summary: "Add a risk to the project" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(RiskWrite) as never })
  @ApiZodResponse(201, Risk, "The risk as stored")
  @ApiZodError(400, "The body is not a valid risk")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  addRisk(@Param("id") id: string, @Body() body: unknown): Promise<Risk> {
    const parsed = RiskWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.riskNotValid");
    return this.projects.addRisk(id, parsed.data);
  }

  @Patch(":id/risks/:rid")
  @ApiOperation({ summary: "Change a risk" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(RiskWrite) as never })
  @ApiZodResponse(200, Risk, "The risk after the change")
  @ApiZodError(400, "The body is not a valid risk")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project or risk")
  updateRisk(
    @Param("id") id: string,
    @Param("rid") rid: string,
    @Body() body: unknown,
  ): Promise<Risk> {
    const parsed = RiskWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.riskNotValid");
    return this.projects.updateRisk(id, rid, parsed.data);
  }

  /** R07: the issue is raised by whoever is signed in, never by a body field. */
  @Post(":id/issues")
  @HttpCode(201)
  @ApiOperation({ summary: "Raise an issue on the project" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(IssueWrite) as never })
  @ApiZodResponse(201, Issue, "The issue as stored, raised by the caller")
  @ApiZodError(400, "The body is not a valid issue")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  addIssue(@Param("id") id: string, @Body() body: unknown): Promise<Issue> {
    const parsed = IssueWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.issueNotValid");
    return this.projects.addIssue(id, parsed.data);
  }

  @Patch(":id/issues/:iid")
  @ApiOperation({ summary: "Change an issue" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "iid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(IssueWrite) as never })
  @ApiZodResponse(200, Issue, "The issue after the change")
  @ApiZodError(400, "The body is not a valid issue")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project or issue")
  updateIssue(
    @Param("id") id: string,
    @Param("iid") iid: string,
    @Body() body: unknown,
  ): Promise<Issue> {
    const parsed = IssueWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.issueNotValid");
    return this.projects.updateIssue(id, iid, parsed.data);
  }
}
