import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { CONFIG, type AppConfig } from "../config";
import { DMS_CLIENT, EArchiveClient, NullClient, type DmsClient } from "./dms-client";
import { DmsAdminController } from "./dms-admin.controller";
import { DmsSenderService } from "./dms-sender.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { LocalDiskObjectStore, OBJECT_STORE } from "./object-store";

/**
 * M8 — eArchive (ADR-0023).
 *
 * The client is chosen at boot and not at each send: with no `EARCHIVE_URL`
 * or no `ECAPITAL_INGEST_TOKEN` the module wires the `NullClient`, every item
 * stays QUEUED and the API says so on `GET /admin/dms/outbox`. That is the
 * «hold until the token is placed» rule; a restart after the token lands is
 * what turns it back on, which is also the moment somebody is watching.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [DocumentsController, DmsAdminController],
  providers: [
    { provide: OBJECT_STORE, useClass: LocalDiskObjectStore },
    {
      provide: DMS_CLIENT,
      inject: [CONFIG],
      useFactory: (config: AppConfig): DmsClient =>
        config.EARCHIVE_URL && config.ECAPITAL_INGEST_TOKEN
          ? new EArchiveClient(config)
          : new NullClient(),
    },
    DocumentsService,
    DmsSenderService,
  ],
  exports: [DocumentsService, DmsSenderService, OBJECT_STORE, DMS_CLIENT],
})
export class DocumentsModule {}
