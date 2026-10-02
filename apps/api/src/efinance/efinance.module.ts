import { Module } from "@nestjs/common";
import { CONFIG, type AppConfig } from "../config";
import { ContractPushService } from "./contract-push.service";
import { EFINANCE_CLIENT } from "./efinance-context";
import { EFinanceClient } from "./efinance-client";
import { EFinanceController } from "./efinance.controller";
import { EFinanceReadService } from "./efinance-read.service";
import { EFinanceSyncService } from "./efinance-sync.service";

/**
 * ADR-0029 — the eFinance client and everything built on it.
 *
 * One client per process, chosen at boot from EFINANCE_TOKEN and
 * EFINANCE_API_URL: with no token placed it reports `configured: false` and
 * every caller holds, as the eArchive sender does (ADR-0023 §4). A restart
 * after the token lands is what turns it on.
 *
 * Imports nothing from the feature modules: contracts, projects, contractors,
 * cost and budget codes import this one, so the arrows only point one way.
 * The timers need `ScheduleModule.forRoot()`, which DocumentsModule already
 * registers for the whole application.
 */
@Module({
  controllers: [EFinanceController],
  providers: [
    {
      provide: EFINANCE_CLIENT,
      inject: [CONFIG],
      useFactory: (config: AppConfig): EFinanceClient => EFinanceClient.fromConfig(config),
    },
    ContractPushService,
    EFinanceReadService,
    EFinanceSyncService,
  ],
  exports: [EFINANCE_CLIENT, ContractPushService, EFinanceReadService, EFinanceSyncService],
})
export class EFinanceModule {}
