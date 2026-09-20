import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

/**
 * M4 — Πάγια, the asset register (R26–R30, R45). ADR-0028.
 *
 * `DocumentsModule` is imported and not re-implemented: an asset's papers are
 * filed with eArchive by the same service, through the same outbox, in the
 * same transaction as the `asset_document` link (ADR-0023).
 */
@Module({
  imports: [DocumentsModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
