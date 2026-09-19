import { Module } from "@nestjs/common";
import { ContractorsModule } from "../contractors/contractors.module";
import { CostModule } from "../cost/cost.module";
import { ContractsController } from "./contracts.controller";
import { ContractsService } from "./contracts.service";

@Module({
  // M2 (R31): approving a variation moves the commitment, so the cost
  // warnings are re-evaluated from here rather than reimplemented.
  imports: [ContractorsModule, CostModule],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
