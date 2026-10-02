import { Module } from "@nestjs/common";
import { EFinanceModule } from "../efinance/efinance.module";
import { BudgetCodesController } from "./budget-codes.controller";
import { BudgetCodesService } from "./budget-codes.service";

@Module({
  // ADR-0029: the eFinance read goes through the one EFinanceClient.
  imports: [EFinanceModule],
  controllers: [BudgetCodesController],
  providers: [BudgetCodesService],
  exports: [BudgetCodesService],
})
export class BudgetCodesModule {}
