import { Global, Module } from "@nestjs/common";
import { NeedsGuard } from "./needs.guard";
import { PermissionsController } from "./permissions.controller";
import { PermissionsService } from "./permissions.service";

/**
 * ADR-0033. Global, because the guard runs on every route and the services
 * that still ask a question in code (the approved budget, the phase moving
 * back, a certificate's next step) all ask the same copy of the matrix.
 */
@Global()
@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService, NeedsGuard],
  exports: [PermissionsService, NeedsGuard],
})
export class PermissionsModule {}
