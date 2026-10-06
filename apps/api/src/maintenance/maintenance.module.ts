import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DocumentsModule } from "../documents/documents.module";
import { BacklogController } from "./backlog.controller";
import { BacklogService } from "./backlog.service";
import { MaintenanceContractsService } from "./contracts.service";
import { MaintenanceSweepService } from "./maintenance-sweep.service";
import { MaintenanceController } from "./maintenance.controller";
import { ScorecardService } from "./scorecard.service";
import { SchedulesService } from "./schedules.service";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";

/**
 * M5 — Συντήρηση (R32–R37). ADR-0031.
 *
 * `DocumentsModule` is imported and not re-implemented: a work order's
 * photographs and the contractor's report go to eArchive by the same service
 * and through the same outbox as an asset's papers (ADR-0023).
 * `ScheduleModule.forRoot()` is idempotent across modules, so the hourly
 * sweep shares the one scheduler with the breach sweep and the eArchive
 * sender.
 */
@Module({
  imports: [ScheduleModule.forRoot(), DocumentsModule],
  controllers: [MaintenanceController, WorkOrdersController, BacklogController],
  providers: [
    MaintenanceContractsService,
    SchedulesService,
    WorkOrdersService,
    BacklogService,
    ScorecardService,
    MaintenanceSweepService,
  ],
  exports: [SchedulesService, WorkOrdersService, BacklogService, MaintenanceSweepService],
})
export class MaintenanceModule {}
