import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { AuditModule } from "./audit/audit.module";
import { AreasModule } from "./areas/areas.module";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { MutationInterceptor } from "./common/mutation.interceptor";
import { RlsInterceptor } from "./common/rls.interceptor";
import { CONFIG, type AppConfig } from "./config";
import { CoreModule } from "./core.module";
import { HealthModule } from "./health/health.module";
import { OrgUnitsModule } from "./org-units/org-units.module";

@Module({
  imports: [
    CoreModule,
    LoggerModule.forRootAsync({
      imports: [CoreModule],
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          // Structured JSON, one line per request, with an id that joins the
          // lines of one request together. Bodies are never logged: a body
          // can carry a staff email, and logs travel further than data does.
          genReqId: (req: { headers: Record<string, unknown> }) =>
            (req.headers["x-request-id"] as string) || randomUUID(),
          autoLogging: true,
          redact: {
            paths: ["req.headers.authorization", "req.headers.cookie", "req.body", "res.body"],
            remove: true,
          },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
    AuthModule,
    OrgUnitsModule,
    AreasModule,
    HealthModule,
    AuditModule,
  ],
  providers: [
    // Order matters. The guard verifies the token, then the RLS interceptor
    // opens the transaction that carries the caller's identity, and only then
    // does the mutation interceptor get to check that it is inside one.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MutationInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
