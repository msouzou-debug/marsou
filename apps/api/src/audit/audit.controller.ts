import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { AuditLogEntry, AuditLogQuery, AuditService } from "./audit.service";

@ApiTags("audit")
@ApiBearerAuth()
@Controller("audit-log")
@UseGuards(RolesGuard)
@Roles("auditor_readonly", "admin")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * R42. The auditor reads everything and can change nothing; the log has no
   * UPDATE or DELETE grant for any role, the application's included, so this
   * is the only way anybody touches it at all.
   */
  @Get()
  @ApiOperation({ summary: "Audit trail, newest first" })
  @ApiQuery({ name: "entity_type", required: false, example: "area" })
  @ApiQuery({ name: "entity_id", required: false })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 100 } })
  @ApiZodResponse(200, z.array(AuditLogEntry), "The matching entries")
  @ApiZodError(400, "A query parameter is not usable")
  @ApiZodError(403, "The caller is neither an auditor nor an administrator")
  list(@Query() query: unknown): Promise<AuditLogEntry[]> {
    const parsed = AuditLogQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.auditQueryNotValid");
    return this.audit.list(parsed.data);
  }
}
