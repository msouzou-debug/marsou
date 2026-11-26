import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { SiteInstructionsController } from "./site-instructions.controller";
import { SiteInstructionsService } from "./site-instructions.service";

/**
 * `DocumentsModule` is imported, not re-implemented: an instruction's
 * correspondence is filed with eArchive by the same service and the same
 * outbox as every other paper (ADR-0023, owner request 26/11/2026).
 */
@Module({
  imports: [DocumentsModule],
  controllers: [SiteInstructionsController],
  providers: [SiteInstructionsService],
  exports: [SiteInstructionsService],
})
export class SiteInstructionsModule {}
