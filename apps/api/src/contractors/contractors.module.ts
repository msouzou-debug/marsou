import { Module } from "@nestjs/common";
import { EFinanceModule } from "../efinance/efinance.module";
import { ContractorsController } from "./contractors.controller";
import { ContractorsService } from "./contractors.service";

@Module({
  // ADR-0029: a change here can change what eFinance holds for a contract.
  imports: [EFinanceModule],
  controllers: [ContractorsController],
  providers: [ContractorsService],
  exports: [ContractorsService],
})
export class ContractorsModule {}
