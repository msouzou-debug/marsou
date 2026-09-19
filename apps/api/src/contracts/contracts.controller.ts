import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import {
  BoqItem,
  BoqItemWrite,
  ContractCreate,
  ContractDetail,
  ContractList,
  ContractUpdate,
  Variation,
  VariationCreate,
  VariationDecision,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ContractsService } from "./contracts.service";

const BoqWrite = z.array(BoqItemWrite);
const VariationChange = VariationCreate.partial();

/**
 * M1 — contracts, bills of quantities and variations (R08, R10, R13, R31).
 *
 * The routes sit under both `/projects/:id/contracts` and `/contracts/:id`
 * because that is how they are read: a project page lists its contracts, and
 * a contract has a life of its own once it exists.
 *
 * Nothing here decides who may see a contract; the row policies do
 * (ADR-0010), and a contract in a unit the caller may not see answers 404.
 * The one thing this controller does decide is which role may take a decision
 * on a variation at all: a head of estates or an administrator, never the
 * engineer who is running the works. Whether that person is also the one who
 * raised it is R10's rule and lives in the service and in the database
 * (ADR-0015).
 */
@ApiTags("contracts")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get("projects/:id/contracts")
  @ApiOperation({ summary: "The contracts of one project" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ContractList, "The project's contracts, oldest award first")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such project, or none the caller may see")
  list(@Param("id") id: string): Promise<ContractList> {
    return this.contracts.listForProject(id);
  }

  @Post("projects/:id/contracts")
  @HttpCode(201)
  @ApiOperation({ summary: "Record the contract awarded on this project" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ContractCreate) as never })
  @ApiZodResponse(201, ContractDetail, "The contract as stored, with its empty bill and no variations")
  @ApiZodError(400, "The body is not a valid contract")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  @ApiZodError(422, "The contractor is blacklisted, or the project has not been awarded yet")
  create(@Param("id") id: string, @Body() body: unknown): Promise<ContractDetail> {
    const parsed = ContractCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.contractNotValid");
    return this.contracts.create(id, parsed.data);
  }

  @Get("contracts/:id")
  @ApiOperation({ summary: "One contract with its bill, its variations and its warnings" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ContractDetail, "Everything the contract screen needs, warnings included")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  detail(@Param("id") id: string): Promise<ContractDetail> {
    return this.contracts.detail(id);
  }

  @Patch("contracts/:id")
  @ApiOperation({ summary: "Change the terms of a contract; the value is not one of them" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ContractUpdate) as never })
  @ApiZodResponse(200, ContractDetail, "The contract after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "Another contract in the unit already carries that number")
  update(@Param("id") id: string, @Body() body: unknown): Promise<ContractDetail> {
    const parsed = ContractUpdate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.contractNotValid");
    return this.contracts.update(id, sentKeysOnly(parsed.data, body));
  }

  /** The bill is replaced whole; each line's amount is qty × rate, computed here. */
  @Put("contracts/:id/boq")
  @HttpCode(200)
  @ApiOperation({ summary: "Replace the whole bill of quantities" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(BoqWrite) as never })
  @ApiZodResponse(200, z.array(BoqItem), "The bill as stored, by item number")
  @ApiZodError(400, "The body is not a valid bill")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "Two lines carry the same item number")
  replaceBoq(@Param("id") id: string, @Body() body: unknown): Promise<BoqItem[]> {
    const parsed = BoqWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.boqNotValid");
    return this.contracts.replaceBoq(id, parsed.data);
  }

  /** R10: raised by whoever is signed in, in DRAFT, numbered by the database. */
  @Post("contracts/:id/variations")
  @HttpCode(201)
  @ApiOperation({ summary: "Raise a variation on the contract" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(VariationCreate) as never })
  @ApiZodResponse(201, Variation, "The variation as stored, in DRAFT, raised by the caller")
  @ApiZodError(400, "The body is not a valid variation")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract, or none the caller may see")
  addVariation(@Param("id") id: string, @Body() body: unknown): Promise<Variation> {
    const parsed = VariationCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.variationNotValid");
    return this.contracts.createVariation(id, parsed.data);
  }

  @Patch("contracts/:id/variations/:vid")
  @ApiOperation({ summary: "Change a variation while it is still the raiser's" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "vid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(VariationChange) as never })
  @ApiZodResponse(200, Variation, "The variation after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "Somebody other than the raiser, or a read-only account")
  @ApiZodError(404, "No such contract or variation")
  @ApiZodError(422, "The variation has been submitted and is no longer the raiser's to change")
  updateVariation(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: unknown,
  ): Promise<Variation> {
    const parsed = VariationChange.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.variationNotValid");
    return this.contracts.updateVariation(id, vid, sentKeysOnly(parsed.data, body));
  }

  @Post("contracts/:id/variations/:vid/submit")
  @HttpCode(200)
  @ApiOperation({ summary: "Send the variation for a decision" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "vid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, Variation, "The variation, now SUBMITTED")
  @ApiZodError(403, "Somebody other than the raiser, or a read-only account")
  @ApiZodError(404, "No such contract or variation")
  @ApiZodError(422, "The variation is not in a state that can be submitted")
  submitVariation(@Param("id") id: string, @Param("vid") vid: string): Promise<Variation> {
    return this.contracts.submitVariation(id, vid);
  }

  /**
   * RULE (R10, CAPEX-01 §10): the decision belongs to a head of estates or an
   * administrator, and never to the person who raised the variation. The role
   * is checked here, the segregation in the service, and both again in the
   * database (ADR-0015).
   */
  @Post("contracts/:id/variations/:vid/decide")
  @HttpCode(200)
  @Roles("estates_head", "admin")
  @ApiOperation({ summary: "Approve, return or reject a submitted variation" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "vid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(VariationDecision) as never })
  @ApiZodResponse(200, Variation, "The variation with the decision on it")
  @ApiZodError(400, "The body is not a valid decision")
  @ApiZodError(403, "Not an approver, or the person who raised it")
  @ApiZodError(404, "No such contract or variation")
  @ApiZodError(422, "The variation is not awaiting a decision, or a comment is missing")
  decideVariation(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: unknown,
  ): Promise<Variation> {
    const parsed = VariationDecision.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.variationDecisionNotValid");
    return this.contracts.decideVariation(id, vid, parsed.data);
  }
}
