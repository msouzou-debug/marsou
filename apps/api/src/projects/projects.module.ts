import { Module } from "@nestjs/common";
import { EFinanceModule } from "../efinance/efinance.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  // ADR-0029: a change here can change what eFinance holds for a contract.
  imports: [EFinanceModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
