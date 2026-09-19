import { Module } from "@nestjs/common";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";
import { ApproverScopesService } from "./approver-scopes.service";

@Module({
  controllers: [AdminUsersController],
  providers: [AdminUsersService, ApproverScopesService],
  exports: [AdminUsersService, ApproverScopesService],
})
export class AdminUsersModule {}
