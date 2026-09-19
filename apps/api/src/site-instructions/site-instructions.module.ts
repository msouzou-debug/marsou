import { Module } from "@nestjs/common";
import { SiteInstructionsController } from "./site-instructions.controller";
import { SiteInstructionsService } from "./site-instructions.service";

@Module({
  controllers: [SiteInstructionsController],
  providers: [SiteInstructionsService],
  exports: [SiteInstructionsService],
})
export class SiteInstructionsModule {}
