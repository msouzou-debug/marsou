import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AppRole, RolePermissionsResponse, RolePermissionsWrite } from "@ecapital/shared";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { PermissionsService } from "./permissions.service";

/**
 * ADR-0033 — Διαχείριση › Ρόλοι και δικαιώματα. R01 (who may do what), R42
 * (every change audited, by the trigger on `role_permission`).
 *
 * `GET /admin/roles` already answers the role catalogue (ADR-0020) and the
 * users screen reads it, so the matrix lives one step down, at
 * `/admin/roles/permissions`. The two writes sit beside it.
 *
 * The writes are `@Roles("admin")`, an identity check, and not a row of the
 * matrix: a matrix that could grant the right to change the matrix could be
 * used to take it. The row policy on `role_permission` says the same thing a
 * second time underneath.
 */
@ApiTags("admin-roles")
@ApiBearerAuth()
@Controller("admin/roles")
@UseGuards(RolesGuard)
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  /**
   * Any signed-in user: the web decides which controls to offer from it, and
   * the head of estates reads the roles tab.
   */
  @Get("permissions")
  @ApiOperation({ summary: "The role matrix: every area, every role, its level" })
  @ApiZodResponse(200, RolePermissionsResponse, "The matrix, the guardrail keys and the last change")
  @ApiZodError(401, "No token, or a token that does not verify")
  read(): Promise<RolePermissionsResponse> {
    return this.permissions.response();
  }

  /** The whole column for one role. Rows that do not move are not written. */
  @Put(":role")
  @Roles("admin")
  @ApiOperation({ summary: "Replace one role's levels, area by area" })
  @ApiParam({ name: "role", schema: { type: "string", enum: [...AppRole.options] } })
  @ApiBody({ schema: jsonSchema(RolePermissionsWrite) as never })
  @ApiZodResponse(200, RolePermissionsResponse, "The matrix after the change")
  @ApiZodError(400, "Not one of the eight roles, or not a level for every area")
  @ApiZodError(403, "The caller is not an administrator")
  @ApiZodError(422, "errors.rolePermissionGuardrail: a level the guardrails do not allow, with the area named")
  write(@Param("role") role: string, @Body() body: unknown): Promise<RolePermissionsResponse> {
    const parsedRole = AppRole.safeParse(role);
    if (!parsedRole.success) throw AppError.badRequest("errors.rolePermissionNotValid");
    const parsed = RolePermissionsWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.rolePermissionNotValid");
    return this.permissions.writeRole(parsedRole.data, parsed.data);
  }

  /** Every role back to the shipped defaults (`ROLE_MATRIX`). Audited row by row. */
  @Post("reset")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Put every role back to the default matrix" })
  @ApiZodResponse(200, RolePermissionsResponse, "The matrix after the reset")
  @ApiZodError(403, "The caller is not an administrator")
  reset(): Promise<RolePermissionsResponse> {
    return this.permissions.reset();
  }
}
