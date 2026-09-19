import { Module } from "@nestjs/common";
import { BudgetCodesController } from "./budget-codes.controller";
import { BudgetCodesService } from "./budget-codes.service";

@Module({
  controllers: [BudgetCodesController],
  providers: [BudgetCodesService],
  exports: [BudgetCodesService],
})
export class BudgetCodesModule {}
