import { Module } from "@nestjs/common";
import { ContractorsModule } from "../contractors/contractors.module";
import { CostModule } from "../cost/cost.module";
import { EFinanceModule } from "../efinance/efinance.module";
import { ContractsController } from "./contracts.controller";
import { ContractsService } from "./contracts.service";

@Module({
  // M2 (R31): approving a variation moves the commitment, so the cost
  // warnings are re-evaluated from here rather than reimplemented.
  // ADR-0029: the same three writes push the contract to eFinance.
  imports: [ContractorsModule, CostModule, EFinanceModule],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
