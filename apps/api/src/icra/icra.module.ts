import { Module } from "@nestjs/common";
import { IcraController } from "./icra.controller";
import { IcraService } from "./icra.service";

/** M3 — the ICRA matrix and its engine (R20). ADR-0026. */
@Module({
  controllers: [IcraController],
  providers: [IcraService],
  exports: [IcraService],
})
export class IcraModule {}
