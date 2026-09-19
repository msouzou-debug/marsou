import { Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { BudgetCodeList, BudgetCodeSyncResult } from "@ecapital/shared";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { BudgetCodesService } from "./budget-codes.service";

/**
 * ADR-0025 — eFinance's CAPEX budget codes, the reference list
 * `contract.budgetCode` is chosen from.
 *
 * `GET` is open to any signed-in role: S07a's select needs the same twenty
 * rows whichever unit the caller works in, and there is nothing in this
 * table to scope by unit (the row policy says as much — migration 0013).
 * `POST /sync` is admin/finance only, the same two roles ADR-0021 already
 * trusts with the project's approved budget.
 */
@ApiTags("budget-codes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("budget-codes")
export class BudgetCodesController {
  constructor(private readonly budgetCodes: BudgetCodesService) {}

  @Get()
  @ApiOperation({ summary: "The active CAPEX budget codes" })
  @ApiQuery({
    name: "kind",
    required: false,
    schema: { type: "string", enum: ["capex"] },
    description: "The only kind there is today; any other value is refused",
  })
  @ApiZodResponse(200, BudgetCodeList, "The active CAPEX codes, ordered by code")
  @ApiZodError(400, "kind was given and was not capex")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(@Query("kind") kind?: string): Promise<BudgetCodeList> {
    if (kind !== undefined && kind !== "capex") {
      throw AppError.badRequest("errors.budgetCodeQueryNotValid");
    }
    return this.budgetCodes.list();
  }

  /**
   * RULE (ADR-0025): calls eFinance's read endpoint when EFINANCE_URL and
   * EFINANCE_TOKEN are both configured; falls back to eCapital's own seed
   * list otherwise (`BudgetCodesService.reader`). Either way the result is
   * an upsert by code plus deactivating whatever the reader no longer names.
   */
  @Post("sync")
  @HttpCode(200)
  @Roles("admin", "finance")
  @ApiOperation({ summary: "Refresh the budget code list from eFinance, or from the seed" })
  @ApiZodResponse(200, BudgetCodeSyncResult, "What the sync did")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(403, "A role that is not admin or finance")
  @ApiZodError(422, "eFinance did not answer within 5 seconds, or answered with an error")
  sync(): Promise<BudgetCodeSyncResult> {
    return this.budgetCodes.sync();
  }
}
