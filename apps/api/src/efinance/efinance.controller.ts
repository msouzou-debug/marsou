/**
 * ADR-0029 — the eFinance routes.
 *
 * Reads for the contract and project screens, open to anybody who can see
 * the contract or the project (the row policies decide, ADR-0010); the
 * manual push and the two syncs, the administrator's only; and the vendor
 * search the contractor form uses, open to anybody signed in.
 *
 * None of them fails because eFinance is not configured: the reads say
 * `configured: false` with null figures, and the syncs say so and do
 * nothing. What does fail is a push asked for by hand on a contract that
 * cannot be built (422, which field is missing) and a budget position
 * eFinance did not answer (502, eFinance's own code in the sentence).
 */
import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  ContractBudgetPosition,
  EFinanceContractStatus,
  EFinanceInvoiceList,
  EFinanceMasterSyncResult,
  EFinanceRequisitionList,
  EFinanceSyncResult,
  EFinanceVendorList,
  ProjectBudgetPosition,
} from "@ecapital/shared";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ContractPushService } from "./contract-push.service";
import { EFinanceReadService } from "./efinance-read.service";
import { EFinanceSyncService } from "./efinance-sync.service";

@ApiTags("efinance")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class EFinanceController {
  constructor(
    private readonly push: ContractPushService,
    private readonly read: EFinanceReadService,
    private readonly sync: EFinanceSyncService,
  ) {}

  @Get("contracts/:id/efinance")
  @ApiOperation({ summary: "When eFinance last accepted the contract, the last error, and eFinance's figures" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, EFinanceContractStatus, "The push state and the spend figures eFinance answered with")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  status(@Param("id") id: string): Promise<EFinanceContractStatus> {
    return this.read.contractStatus(id);
  }

  /**
   * RULE (ADR-0029): the administrator's "push again" after the cause of a
   * failure — a 409 above all — has been dealt with. The answer is the state
   * after the attempt; a refusal from eFinance is in `lastError`, not an
   * error response, because the attempt itself worked.
   */
  @Post("contracts/:id/efinance/push")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Push the contract to eFinance again, now" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, EFinanceContractStatus, "The push state after the attempt")
  @ApiZodError(403, "A role that is not admin")
  @ApiZodError(404, "No such contract")
  @ApiZodError(409, "The token is placed but EFINANCE_PUSH_ENABLED is off on this server")
  @ApiZodError(422, "The contract has no budget code, or its contractor has no SAP vendor code")
  async pushNow(@Param("id") id: string): Promise<EFinanceContractStatus> {
    if (this.push.pushDisabled) throw AppError.conflict("errors.efinancePushDisabled");
    const outcome = await this.push.push(id);
    if (outcome.outcome === "not-found") throw AppError.notFound("errors.contractNotFound");
    if (outcome.outcome === "not-pushable") {
      const key =
        outcome.missing.length > 1
          ? "errors.efinanceMissingBoth"
          : outcome.missing[0] === "budgetCode"
            ? "errors.efinanceMissingBudgetCode"
            : "errors.efinanceMissingVendorCode";
      throw AppError.unprocessable(key);
    }
    return this.read.contractStatus(id);
  }

  @Get("contracts/:id/efinance/invoices")
  @ApiOperation({ summary: "eFinance's invoices tagged with this contract, reversed ones included" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, EFinanceInvoiceList, "Newest first, header and lines")
  @ApiZodError(404, "No such contract, or none the caller may see")
  invoices(@Param("id") id: string): Promise<EFinanceInvoiceList> {
    return this.read.invoicesOf(id);
  }

  @Get("contracts/:id/efinance/requisitions")
  @ApiOperation({ summary: "eFinance's requisitions tagged with this contract" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, EFinanceRequisitionList, "Newest first")
  @ApiZodError(404, "No such contract, or none the caller may see")
  requisitions(@Param("id") id: string): Promise<EFinanceRequisitionList> {
    return this.read.requisitionsOf(id);
  }

  @Get("contracts/:id/budget-position")
  @ApiOperation({ summary: "eFinance's budget position for the contract's unit, budget code and award year" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "year", required: false, schema: { type: "integer" }, description: "Defaults to the award year" })
  @ApiZodResponse(200, ContractBudgetPosition, "Allocated, booked, requisitions, in flight, available")
  @ApiZodError(400, "year is not a year")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(502, "eFinance did not answer, or answered with an error")
  contractPosition(@Param("id") id: string, @Query("year") year?: string): Promise<ContractBudgetPosition> {
    return this.read.contractPosition(id, yearOf(year));
  }

  @Get("projects/:id/budget-position")
  @ApiOperation({ summary: "eFinance's budget position for every budget code the project's contracts carry" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "year", required: false, schema: { type: "integer" }, description: "Defaults to each contract's award year" })
  @ApiZodResponse(200, ProjectBudgetPosition, "One row per budget code and year, never summed across codes")
  @ApiZodError(400, "year is not a year")
  @ApiZodError(404, "No such project, or none the caller may see")
  @ApiZodError(502, "eFinance did not answer, or answered with an error")
  projectPosition(@Param("id") id: string, @Query("year") year?: string): Promise<ProjectBudgetPosition> {
    return this.read.projectPosition(id, yearOf(year));
  }

  @Post("admin/efinance/sync")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Read invoices and requisitions from eFinance now" })
  @ApiZodResponse(200, EFinanceSyncResult, "What each feed did")
  @ApiZodError(403, "A role that is not admin")
  runSync(): Promise<EFinanceSyncResult> {
    return this.sync.sync();
  }

  @Post("admin/efinance/sync-master")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Read eFinance's entity codes and vendors now" })
  @ApiZodResponse(200, EFinanceMasterSyncResult, "Units matched, vendors written")
  @ApiZodError(403, "A role that is not admin")
  runMaster(): Promise<EFinanceMasterSyncResult> {
    return this.sync.syncMaster();
  }

  @Get("efinance/vendors")
  @ApiOperation({ summary: "Search eFinance's vendors by name or code, twenty at most" })
  @ApiQuery({ name: "q", required: false, schema: { type: "string" } })
  @ApiZodResponse(200, EFinanceVendorList, "Exact code first, then active vendors by name")
  @ApiZodError(401, "No token, or a token that does not verify")
  vendors(@Query("q") q?: string): Promise<EFinanceVendorList> {
    return this.read.vendors(q);
  }
}

function yearOf(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d{4}$/.test(value)) throw AppError.badRequest("errors.efinanceYearNotValid");
  return Number(value);
}
