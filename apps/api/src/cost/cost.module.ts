import { Module } from "@nestjs/common";
import { CostAccrualsService } from "./cost-accruals.service";
import { CostController } from "./cost.controller";
import { CostImportsService } from "./cost-imports.service";
import { CostWarningsService } from "./cost-warnings.service";
import { PaymentCertsController } from "./payment-certs.controller";
import { PaymentCertsService } from "./payment-certs.service";
import { ProjectCostController } from "./project-cost.controller";
import { ProjectCostService } from "./project-cost.service";

/**
 * M2 — the cost module (R11, R13–R18, R31).
 *
 * `CostWarningsService` is exported because R31 fires on writes that live
 * outside this module: approving a variation moves a contract's commitment,
 * and the contracts module calls in rather than growing a second
 * implementation of the five rules.
 */
@Module({
  controllers: [CostController, ProjectCostController, PaymentCertsController],
  providers: [
    CostImportsService,
    CostWarningsService,
    ProjectCostService,
    PaymentCertsService,
    CostAccrualsService,
  ],
  exports: [CostWarningsService],
})
export class CostModule {}
