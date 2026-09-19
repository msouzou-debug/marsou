import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Rfi, RfiAnswer, RfiCreate } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { RfisService } from "./rfis.service";

/**
 * M1 — the RFI log (R09). Αίτημα διευκρίνισης.
 *
 * The routes sit under `/contracts/:id/rfis` because that is how an RFI is
 * read: it is a question about one contract's works and it has no life apart
 * from it.
 *
 * Nothing here decides who may see an RFI; the row policies do (ADR-0010).
 * Nothing here decides who may answer one either — unlike a variation, an RFI
 * has no approver, because answering a question is not a decision about money
 * (ADR-0017).
 */
@ApiTags("site log")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class RfisController {
  constructor(private readonly rfis: RfisService) {}

  @Get("contracts/:id/rfis")
  @ApiOperation({ summary: "The RFIs on one contract, newest first, with their SLA band" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(Rfi), "The contract's RFIs, newest number first")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  list(@Param("id") id: string): Promise<Rfi[]> {
    return this.rfis.list(id, new Date());
  }

  @Post("contracts/:id/rfis")
  @HttpCode(201)
  @ApiOperation({ summary: "Raise an RFI on the contract; the API sets the SLA clock" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(RfiCreate) as never })
  @ApiZodResponse(201, Rfi, "The RFI as stored, OPEN, raised by the caller, numbered per contract")
  @ApiZodError(400, "The body is not a valid RFI")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract, or none the caller may see")
  create(@Param("id") id: string, @Body() body: unknown): Promise<Rfi> {
    const parsed = RfiCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.rfiNotValid");
    return this.rfis.create(id, parsed.data, new Date());
  }

  /** RULE (ADR-0017): the answerer may be the raiser; see the service. */
  @Post("contracts/:id/rfis/:rid/answer")
  @HttpCode(200)
  @ApiOperation({ summary: "Answer an open RFI" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(RfiAnswer) as never })
  @ApiZodResponse(200, Rfi, "The RFI, now ANSWERED, with the answer and who gave it")
  @ApiZodError(400, "The body carries no answer")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or RFI")
  @ApiZodError(422, "The RFI has already been answered")
  answer(
    @Param("id") id: string,
    @Param("rid") rid: string,
    @Body() body: unknown,
  ): Promise<Rfi> {
    const parsed = RfiAnswer.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.rfiAnswerNotValid");
    return this.rfis.answer(id, rid, parsed.data, new Date());
  }

  @Post("contracts/:id/rfis/:rid/close")
  @HttpCode(200)
  @ApiOperation({ summary: "Close an answered RFI" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, Rfi, "The RFI, now CLOSED")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or RFI")
  @ApiZodError(422, "The RFI has not been answered yet, or is closed already")
  close(@Param("id") id: string, @Param("rid") rid: string): Promise<Rfi> {
    return this.rfis.close(id, rid, new Date());
  }
}
