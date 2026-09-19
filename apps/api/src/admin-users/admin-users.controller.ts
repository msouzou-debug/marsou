import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  AdminUser,
  AdminUserCreate,
  AdminUserList,
  AdminUserUpdate,
  RoleCatalogue,
} from "@ecapital/shared";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { Roles, RolesGuard } from "../common/roles.guard";
import { parseAdminUserListQuery } from "./admin-user-query";
import { AdminUsersService } from "./admin-users.service";

/**
 * ADR-0020 — Διαχείριση › Χρήστες. R01 (who may see what), R02 (the eight
 * personas), R42 (every change audited).
 *
 * Administrator only, and said twice: `@Roles("admin")` closes the routes,
 * and the row policies on `app_user`, `app_user_role` and `app_user_org_unit`
 * close the tables underneath them (ADR-0010). Neither is decoration — the
 * guard is what turns a head of estates away with 403 instead of 404, and the
 * policies are what would still refuse the write if this decorator were ever
 * deleted.
 */
@ApiTags("admin-users")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(RolesGuard)
@Roles("admin")
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /**
   * The eight roles with their scope, so the screen does not hardcode which
   * of them carry units and which reach every unit anyway.
   */
  @Get("roles")
  @ApiOperation({ summary: "The eight roles and whether each is scoped to units" })
  @ApiZodResponse(200, RoleCatalogue, "The role catalogue")
  @ApiZodError(403, "The caller is not an administrator")
  roles(): RoleCatalogue {
    return this.users.catalogue();
  }

  @Get("users")
  @ApiOperation({ summary: "The accounts, filtered, searched and paged" })
  @ApiQuery({ name: "q", required: false, schema: { type: "string" }, description: "Matches the name, the account name and the address" })
  @ApiQuery({ name: "role", required: false, isArray: true, schema: { type: "array", items: { type: "string" } } })
  @ApiQuery({ name: "unit", required: false, isArray: true, schema: { type: "array", items: { type: "string" } } })
  @ApiQuery({ name: "active", required: false, schema: { type: "boolean" }, description: "Left out, both" })
  @ApiQuery({ name: "page", required: false, schema: { type: "integer", default: 1 } })
  @ApiQuery({ name: "pageSize", required: false, schema: { type: "integer", default: 50 } })
  @ApiZodResponse(200, AdminUserList, "One page of accounts, with the total behind it")
  @ApiZodError(400, "A filter or a page number is not usable")
  @ApiZodError(403, "The caller is not an administrator")
  list(@Query() query: unknown): Promise<AdminUserList> {
    const parsed = parseAdminUserListQuery(query);
    if (!parsed.success) throw AppError.badRequest("errors.adminUserQueryNotValid");
    return this.users.list(parsed.data);
  }

  @Get("users/:id")
  @ApiOperation({ summary: "One account, with its roles and its units" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, AdminUser, "The account")
  @ApiZodError(403, "The caller is not an administrator")
  @ApiZodError(404, "No such account")
  detail(@Param("id") id: string): Promise<AdminUser> {
    return this.users.detail(id);
  }

  /**
   * Pre-register an Active Directory account before it has ever signed in.
   * The subject is `ad:<username>` until the first bind adopts the
   * objectGUID (ADR-0020), so the roles set here are in force the moment the
   * person arrives.
   */
  @Post("users")
  @HttpCode(201)
  @ApiOperation({ summary: "Pre-register an account, with its roles and units" })
  @ApiBody({ schema: jsonSchema(AdminUserCreate) as never })
  @ApiZodResponse(201, AdminUser, "The account as stored")
  @ApiZodError(400, "The body is not a valid account")
  @ApiZodError(403, "The caller is not an administrator")
  @ApiZodError(422, "That account name is taken, a unit is missing, or the auditor was asked for")
  create(@Body() body: unknown): Promise<AdminUser> {
    const parsed = AdminUserCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.adminUserNotValid");
    return this.users.create(parsed.data);
  }

  /** The four rules are in the service, each with its own sentence. */
  @Patch("users/:id")
  @ApiOperation({ summary: "Change an account's roles, units, name or whether it is on" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(AdminUserUpdate) as never })
  @ApiZodResponse(200, AdminUser, "The account after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "The caller is not an administrator")
  @ApiZodError(404, "No such account")
  @ApiZodError(422, "errors.selfLockout, errors.lastAdmin, errors.auditorProtected or errors.unitRequired")
  update(@Param("id") id: string, @Body() body: unknown): Promise<AdminUser> {
    const parsed = AdminUserUpdate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.adminUserNotValid");
    return this.users.update(id, sentKeysOnly(parsed.data, body));
  }
}
