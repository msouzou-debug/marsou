import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Contractor, ContractorCreate } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { ContractorUpdate } from "./contractor-write";
import { ContractorsService } from "./contractors.service";

/**
 * M1 — the supplier register (R08). Shared across the twelve units: a
 * contractor is a company, not a hospital's property, so there is no unit
 * filter here and every signed-in user reads the list.
 *
 * Who may write it is the row policy's decision (ADR-0010): admin and the
 * heads of estates. The one rule this controller's service does state is
 * R08's blacklist, which only an administrator may move.
 */
@ApiTags("contractors")
@ApiBearerAuth()
@Controller("contractors")
export class ContractorsController {
  constructor(private readonly contractors: ContractorsService) {}

  @Get()
  @ApiOperation({ summary: "The supplier register, by name" })
  @ApiZodResponse(200, z.array(Contractor), "Every contractor the organisation deals with")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(): Promise<Contractor[]> {
    return this.contractors.list();
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Add a contractor to the register" })
  @ApiBody({ schema: jsonSchema(ContractorCreate) as never })
  @ApiZodResponse(201, Contractor, "The contractor as stored, not blacklisted")
  @ApiZodError(400, "The body is not a valid contractor")
  @ApiZodError(403, "A read-only account, or a role that does not keep the register")
  @ApiZodError(422, "Another contractor already has that name")
  create(@Body() body: unknown): Promise<Contractor> {
    const parsed = ContractorCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.contractorNotValid");
    return this.contractors.create(parsed.data);
  }

  /** RULE (R08): `blacklisted` is an administrator's field; see the service. */
  @Patch(":id")
  @ApiOperation({ summary: "Change a contractor; only an administrator may blacklist one" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ContractorUpdate) as never })
  @ApiZodResponse(200, Contractor, "The contractor after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A read-only account, or an attempt to blacklist without being an administrator")
  @ApiZodError(404, "No such contractor")
  @ApiZodError(422, "Another contractor already has that name")
  update(@Param("id") id: string, @Body() body: unknown): Promise<Contractor> {
    const parsed = ContractorUpdate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.contractorNotValid");
    return this.contractors.update(id, sentKeysOnly(parsed.data, body));
  }
}
