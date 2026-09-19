import { Module } from "@nestjs/common";
import { SystemFeedsController } from "./system-feeds.controller";
import { SystemFeedsService } from "./system-feeds.service";

/** M3 — system feeds and indirect impact (R19, §6.1). ADR-0026. */
@Module({
  controllers: [SystemFeedsController],
  providers: [SystemFeedsService],
  exports: [SystemFeedsService],
})
export class SystemFeedsModule {}
