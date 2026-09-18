import { Global, Module } from "@nestjs/common";
import { I18nService } from "./common/i18n.service";
import { CONFIG, loadConfig, type AppConfig } from "./config";
import { DatabaseService } from "./db/client";

/**
 * The three things every module needs: the validated environment, the
 * database and the message catalogue. Global so a feature module does not
 * have to list them, and so there is exactly one connection pool.
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: I18nService,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => new I18nService(config.DEFAULT_LOCALE),
    },
    DatabaseService,
  ],
  exports: [CONFIG, I18nService, DatabaseService],
})
export class CoreModule {}
