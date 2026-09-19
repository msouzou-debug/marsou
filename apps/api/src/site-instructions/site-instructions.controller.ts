import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { SiteInstruction, SiteInstructionCreate, Variation } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { SiteInstructionsService } from "./site-instructions.service";

/**
 * M1 — the site instruction log (R09). Οδηγία εργοταξίου.
 *
 * Like the RFI log, these hang off one contract and have no life apart from
 * it. The one rule the routes carry is the link to a variation, and it is a
 * decision about money rather than an access rule, so it lives in the service
 * and in the database rather than in a role check (ADR-0017).
 */
@ApiTags("site log")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class SiteInstructionsController {
  constructor(private readonly instructions: SiteInstructionsService) {}

  @Get("contracts/:id/site-instructions")
  @ApiOperation({ summary: "The site instructions on one contract, newest first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(SiteInstruction), "The contract's instructions, newest number first")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  list(@Param("id") id: string): Promise<SiteInstruction[]> {
    return this.instructions.list(id);
  }

  @Post("contracts/:id/site-instructions")
  @HttpCode(201)
  @ApiOperation({ summary: "Issue a site instruction; the API numbers it" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SiteInstructionCreate) as never })
  @ApiZodResponse(201, SiteInstruction, "The instruction as stored, issued by the caller")
  @ApiZodError(400, "The body is not a valid instruction")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract, or none the caller may see")
  create(@Param("id") id: string, @Body() body: unknown): Promise<SiteInstruction> {
    const parsed = SiteInstructionCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.siteInstructionNotValid");
    return this.instructions.create(id, parsed.data);
  }

  /**
   * RULE (R09): only an instruction with cost impact (422 errors.noCostImpact
   * otherwise), and only once (422 errors.alreadyLinked).
   */
  @Post("contracts/:id/site-instructions/:sid/variation")
  @HttpCode(201)
  @ApiOperation({ summary: "Turn a cost-impact instruction into a draft variation" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "sid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(201, Variation, "The new variation, DRAFT, priced at zero for the engineer")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or instruction")
  @ApiZodError(422, "The instruction carries no cost impact, or already has a variation")
  createVariation(@Param("id") id: string, @Param("sid") sid: string): Promise<Variation> {
    return this.instructions.createVariation(id, sid);
  }
}
