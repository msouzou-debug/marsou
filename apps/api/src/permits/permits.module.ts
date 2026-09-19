import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { IcraModule } from "../icra/icra.module";
import { SystemFeedsModule } from "../system-feeds/system-feeds.module";
import { BreachService } from "./breach.service";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { PermitsController } from "./permits.controller";
import { PermitsService } from "./permits.service";

/**
 * M3 — Διακοπές και άδειες εργασίας (R19–R25). ADR-0026.
 *
 * `ScheduleModule.forRoot()` is idempotent across modules, so the breach
 * sweep and the eArchive sender share one scheduler.
 */
@Module({
  imports: [ScheduleModule.forRoot(), IcraModule, SystemFeedsModule],
  controllers: [PermitsController, CalendarController, InboxController],
  providers: [PermitsService, CalendarService, InboxService, BreachService],
  exports: [PermitsService, BreachService],
})
export class PermitsModule {}
