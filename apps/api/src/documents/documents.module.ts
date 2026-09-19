import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { LocalDiskObjectStore, OBJECT_STORE } from "./object-store";

/**
 * M8 — eArchive (ADR-0023). The upload side: the object store, the three
 * routes that file an award decision, a business case and an approved
 * variation, and the service that writes the document row and the queue row
 * in one transaction.
 */
@Module({
  controllers: [DocumentsController],
  providers: [
    { provide: OBJECT_STORE, useClass: LocalDiskObjectStore },
    DocumentsService,
  ],
  exports: [DocumentsService, OBJECT_STORE],
})
export class DocumentsModule {}
