import { Module } from "@nestjs/common";
import { CostModule } from "../cost/cost.module";
import { MaintenanceModule } from "../maintenance/maintenance.module";
import { PermitsModule } from "../permits/permits.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { ProjectsModule } from "../projects/projects.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * M6 — Αναφορές (R39). ADR-0032.
 *
 * No table of its own: every figure is read through the module that owns it
 * — the portfolio and the projects (M1), the cost ledgers (M2), the
 * disruption hours (M3), the backlog, the agreements and the scorecard (M5).
 */
@Module({
  imports: [PortfolioModule, ProjectsModule, CostModule, PermitsModule, MaintenanceModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
