import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { RfisController } from "./rfis.controller";
import { RfisService } from "./rfis.service";

/**
 * `DocumentsModule` is imported, not re-implemented: an RFI's evidence (the
 * sent e-mail, the reply) is filed with eArchive by the same service and the
 * same outbox as every other paper (ADR-0023, owner decision 25/11/2026).
 */
@Module({
  imports: [DocumentsModule],
  controllers: [RfisController],
  providers: [RfisService],
  exports: [RfisService],
})
export class RfisModule {}
