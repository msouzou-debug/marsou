import { Module } from "@nestjs/common";
import { RfisController } from "./rfis.controller";
import { RfisService } from "./rfis.service";

@Module({
  controllers: [RfisController],
  providers: [RfisService],
  exports: [RfisService],
})
export class RfisModule {}
