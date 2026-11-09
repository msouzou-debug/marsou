import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  BoqItem,
  BoqItemWrite,
  ContractClaimWrite,
  ContractCreate,
  ContractDelay,
  ContractDetail,
  ContractExtensionWrite,
  ContractList,
  ContractListQuery,
  ContractLookup,
  ContractSectionWrite,
  ContractUpdate,
  DelayActivation,
  Variation,
  VariationCreate,
  VariationDecision,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { RolesGuard } from "../common/roles.guard";
import { Needs } from "../permissions/needs.guard";
import { ContractsService } from "./contracts.service";

const BoqWrite = z.array(BoqItemWrite);
const VariationChange = VariationCreate.partial();
const SectionChange = ContractSectionWrite.partial();
const ClaimChange = ContractClaimWrite.partial();

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
  @ApiZodError(400, "The body is not a valid contract, or budgetCode does not name an active code")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such project, or none the caller may see")
  @ApiZodError(422, "The contractor is blacklisted, or the project has not been awarded yet")
  create(@Param("id") id: string, @Body() body: unknown): Promise<ContractDetail> {
    const parsed = ContractCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.contractNotValid");
    return this.contracts.create(id, parsed.data);
  }

  /**
   * ADR-0019. The register across every project the caller may see — what
   * `/contracts` on the web lists when nobody has passed a reference.
   */
  @Get("contracts")
  @ApiOperation({ summary: "Every contract the caller may see, newest award first" })
  @ApiQuery({ name: "unit", required: false, schema: { type: "string" } })
  @ApiQuery({ name: "q", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, ContractList, "The caller's contracts, newest award first")
  @ApiZodError(400, "The query is not valid")
  @ApiZodError(401, "No token, or a token that does not verify")
  listAll(@Query() query: unknown): Promise<ContractList> {
    const parsed = ContractListQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.contractQueryNotValid");
    return this.contracts.listAll(parsed.data);
  }

  /**
   * ADR-0019. Resolve a reference to a contract id, so eFinance can point a
   * `contract_ref` at eCapital the same way it points one at eMAP. Declared
   * before `contracts/:id` because Nest matches routes in the order they are
   * written, and `lookup` would otherwise be read as an id.
   */
  @Get("contracts/lookup")
  @ApiOperation({ summary: "Resolve CAP-YYYY-NNNN, or a contract number, to an id" })
  @ApiQuery({ name: "q", required: true, schema: { type: "string" } })
  @ApiZodResponse(200, ContractLookup, "The id of the one contract that reference names")
  @ApiZodError(400, "No reference was given")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No contract carries that reference, or none the caller may see")
  lookup(@Query("q") q?: string): Promise<ContractLookup> {
    if (!q) throw AppError.badRequest("errors.contractRefNeeded");
    return this.contracts.lookup(q);
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
  @ApiZodError(400, "The body is not a valid change, or budgetCode does not name an active code")
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

  // ------------------------------------------------------------ ADR-0035 --
  // Sections, extensions of time, claims and the delay penalty. Writing them
  // is `contractRecords` WRITE (admin, head of estates, project engineer);
  // activating the penalty is APPROVE (admin and head of estates by default).
  // Every write answers with the whole contract, because each one moves the
  // delay figures and the warnings on it.

  @Get("contracts/:id/delay")
  @ApiOperation({ summary: "The delay clocks and the accrued penalty, shown and never deducted" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ContractDelay, "The clocks, the totals and the open claims, as at today in Nicosia")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  delay(@Param("id") id: string): Promise<ContractDelay> {
    return this.contracts.delay(id);
  }

  @Post("contracts/:id/sections")
  @Needs("contractRecords", "WRITE")
  @HttpCode(201)
  @ApiOperation({ summary: "Add a section (Τμήμα) with its own completion date and clock" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ContractSectionWrite) as never })
  @ApiZodResponse(201, ContractDetail, "The contract with the section on it")
  @ApiZodError(400, "The body is not a valid section")
  @ApiZodError(403, "A role that does not write contracts, or a read-only account")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "Another section of the contract already carries that code")
  addSection(@Param("id") id: string, @Body() body: unknown): Promise<ContractDetail> {
    const parsed = ContractSectionWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.sectionNotValid");
    return this.contracts.addSection(id, parsed.data);
  }

  @Patch("contracts/:id/sections/:sid")
  @Needs("contractRecords", "WRITE")
  @ApiOperation({ summary: "Change a section; a handover date stops its clock" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "sid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SectionChange) as never })
  @ApiZodResponse(200, ContractDetail, "The contract after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A role that does not write contracts, or a read-only account")
  @ApiZodError(404, "No such contract or section")
  @ApiZodError(422, "Another section of the contract already carries that code")
  updateSection(
    @Param("id") id: string,
    @Param("sid") sid: string,
    @Body() body: unknown,
  ): Promise<ContractDetail> {
    const parsed = SectionChange.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.sectionNotValid");
    return this.contracts.updateSection(id, sid, sentKeysOnly(parsed.data, body));
  }

  @Delete("contracts/:id/sections/:sid")
  @Needs("contractRecords", "WRITE")
  @ApiOperation({ summary: "Remove a section; its extensions return to the contract's own clock" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "sid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ContractDetail, "The contract without the section")
  @ApiZodError(403, "A role that does not write contracts, or a read-only account")
  @ApiZodError(404, "No such contract or section")
  deleteSection(@Param("id") id: string, @Param("sid") sid: string): Promise<ContractDetail> {
    return this.contracts.deleteSection(id, sid);
  }

  @Post("contracts/:id/extensions")
  @Needs("contractRecords", "WRITE")
  @HttpCode(201)
  @ApiOperation({ summary: "Record an approved extension of time (παράταση)" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ContractExtensionWrite) as never })
  @ApiZodResponse(201, ContractDetail, "The contract with the extension and the moved due date")
  @ApiZodError(400, "The body is not a valid extension")
  @ApiZodError(403, "A role that does not write contracts, or a read-only account")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "The section named is not one of this contract's")
  addExtension(@Param("id") id: string, @Body() body: unknown): Promise<ContractDetail> {
    const parsed = ContractExtensionWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.extensionNotValid");
    return this.contracts.addExtension(id, parsed.data);
  }

  @Delete("contracts/:id/extensions/:eid")
  @Needs("contractRecords", "WRITE")
  @ApiOperation({ summary: "Remove an extension recorded in error" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "eid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, ContractDetail, "The contract without the extension")
  @ApiZodError(403, "A role that does not write contracts, or a read-only account")
  @ApiZodError(404, "No such contract or extension")
  deleteExtension(@Param("id") id: string, @Param("eid") eid: string): Promise<ContractDetail> {
    return this.contracts.deleteExtension(id, eid);
  }

  @Post("contracts/:id/claims")
  @Needs("contractRecords", "WRITE")
  @HttpCode(201)
  @ApiOperation({ summary: "Record a claim (αξίωση) by the contractor or by the Organisation" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ContractClaimWrite) as never })
  @ApiZodResponse(201, ContractDetail, "The contract with the claim on it")
  @ApiZodError(400, "The body is not a valid claim")
  @ApiZodError(403, "A role that does not write contracts, or a read-only account")
  @ApiZodError(404, "No such contract, or none the caller may see")
  addClaim(@Param("id") id: string, @Body() body: unknown): Promise<ContractDetail> {
    const parsed = ContractClaimWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.claimNotValid");
    return this.contracts.addClaim(id, parsed.data);
  }

  @Patch("contracts/:id/claims/:cid")
  @Needs("contractRecords", "WRITE")
  @ApiOperation({ summary: "Change a claim: its stage, amount, advisor or notes" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "cid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ClaimChange) as never })
  @ApiZodResponse(200, ContractDetail, "The contract after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A role that does not write contracts, or a read-only account")
  @ApiZodError(404, "No such contract or claim")
  updateClaim(
    @Param("id") id: string,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ): Promise<ContractDetail> {
    const parsed = ClaimChange.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.claimNotValid");
    return this.contracts.updateClaim(id, cid, sentKeysOnly(parsed.data, body));
  }

  /**
   * RULE (ADR-0035 §1, §7): the head of estates records the activation of the
   * penalty on one clock. APPROVE on the contract row, not WRITE: the engineer
   * who runs the works records the facts, and somebody above them decides
   * that the clause is being applied.
   */
  @Post("contracts/:id/delay/activate")
  @Needs("contractRecords", "APPROVE")
  @HttpCode(200)
  @ApiOperation({ summary: "Record that the delay penalty is applied on a section or on the contract" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(DelayActivation) as never })
  @ApiZodResponse(200, ContractDetail, "The contract with the activation on the clock")
  @ApiZodError(400, "The body is not a valid activation")
  @ApiZodError(403, "A role that does not approve on contracts, or a read-only account")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "The section is not this contract's, or the contract has sections and no clock of its own")
  activateDelay(@Param("id") id: string, @Body() body: unknown): Promise<ContractDetail> {
    const parsed = DelayActivation.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.delayActivationNotValid");
    return this.contracts.activateDelay(id, parsed.data);
  }

  /** R10: raised by whoever is signed in, in DRAFT, numbered by the database. */
  @Post("contracts/:id/variations")
  @Needs("variationSubmit", "WRITE")
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
  @Needs("variationSubmit", "WRITE")
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
  @Needs("variationSubmit", "WRITE")
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
  @Needs("variationDecide", "APPROVE")
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
