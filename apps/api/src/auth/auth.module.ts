import { Global, Module } from "@nestjs/common";
import { CONFIG, type AppConfig } from "../config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { DIRECTORY, type Directory } from "./directory";
import { LdaptsDirectory } from "./ldap.directory";

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    // ADR-0018. The directory is a provider rather than something the service
    // builds for itself, so a test can put a fake one in its place at the one
    // boundary the API owns. Null in dev and oidc mode: there is nothing to
    // bind against, and `/auth/login` answers 404.
    {
      provide: DIRECTORY,
      inject: [CONFIG],
      useFactory: (config: AppConfig): Directory | null =>
        config.authMode === "ldap" ? new LdaptsDirectory(config) : null,
    },
    AuthService,
    AuthGuard,
  ],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
