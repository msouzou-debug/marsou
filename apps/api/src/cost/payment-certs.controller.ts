import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { PaymentCert, PaymentCertCreate } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { PaymentCertTransitionBody } from "./cost-contracts";
import { PaymentCertsService } from "./payment-certs.service";

/**
 * M3/M2 — payment certificates (R11).
 *
 * The routes sit under both `/contracts/:id/payment-certs` and
 * `/payment-certs/:id` for the same reason the contract routes do: a contract
 * page lists its certificates, and a certificate has a life of its own once
 * it exists — finance opens one from a work queue, not from a contract.
 *
 * RULE (CAPEX-01 §10): the approver is never the creator. The route decides
 * only which role may take which step; who may take it on this particular
 * certificate is the service's rule and the database's constraint
 * (ADR-0015's precedent, migration 0011).
 */
@ApiTags("cost")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class PaymentCertsController {
  constructor(private readonly certs: PaymentCertsService) {}

  @Get("contracts/:id/payment-certs")
  @ApiOperation({ summary: "The payment certificates of one contract, in number order" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(PaymentCert), "The certificates, first to last")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  list(@Param("id") id: string): Promise<PaymentCert[]> {
    return this.certs.listForContract(id);
  }

  /**
   * R11. The number, the retention, the previously certified total and the
   * net payable are all the API's: `PaymentCertCreate` carries the period and
   * the two measured figures and nothing else.
   */
  @Post("contracts/:id/payment-certs")
  @HttpCode(201)
  @Roles("project_engineer", "estates_head", "admin")
  @ApiOperation({ summary: "Draft a payment certificate on the contract" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(PaymentCertCreate) as never })
  @ApiZodResponse(201, PaymentCert, "The certificate in DRAFT, with its derived figures")
  @ApiZodError(400, "The body is not a valid certificate")
  @ApiZodError(403, "A read-only account, or a role that does not certify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "The period ends before it starts")
  create(@Param("id") id: string, @Body() body: unknown): Promise<PaymentCert> {
    const parsed = PaymentCertCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.paymentCertNotValid");
    return this.certs.create(id, parsed.data);
  }

  @Get("payment-certs/:id")
  @ApiOperation({ summary: "One payment certificate" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, PaymentCert, "The certificate as stored")
  @ApiZodError(404, "No such certificate, or none the caller may see")
  detail(@Param("id") id: string): Promise<PaymentCert> {
    return this.certs.detail(id);
  }

  /**
   * R11. One step forward: DRAFT → ENGINEER_APPROVED → FINANCE_RECEIVED →
   * PAID. Never back, and never by the person who wrote it.
   */
  @Post("payment-certs/:id/transition")
  @HttpCode(200)
  @Roles("project_engineer", "estates_head", "finance", "admin")
  @ApiOperation({ summary: "Move the certificate to the next status" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(PaymentCertTransitionBody) as never })
  @ApiZodResponse(200, PaymentCert, "The certificate in its new status")
  @ApiZodError(400, "The body is not a valid transition")
  @ApiZodError(403, "The person who created it, or a role that may not take this step")
  @ApiZodError(404, "No such certificate, or none the caller may see")
  @ApiZodError(422, "Not the next status, or a field this status needs is missing")
  transition(@Param("id") id: string, @Body() body: unknown): Promise<PaymentCert> {
    const parsed = PaymentCertTransitionBody.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.certTransitionNotValid");
    return this.certs.transition(id, parsed.data);
  }
}
