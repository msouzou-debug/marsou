import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Inbox } from "@ecapital/shared";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { InboxService } from "./inbox.service";

/**
 * S14 — Εγκρίσεις. What is waiting on the caller, and nothing else.
 *
 * There is no role guard and no unit check here on purpose: an inbox is
 * personal. A caller with nothing assigned to them gets an empty list rather
 * than a 403, because «you have no approvals waiting» is the right answer for
 * a technician, not an error.
 */
@ApiTags("permits")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("inbox")
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({ summary: "The approvals waiting on the caller, with a count per type" })
  @ApiZodResponse(200, Inbox, "The items and the counts behind the tabs")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(): Promise<Inbox> {
    return this.inbox.forCaller(new Date());
  }

  @Post(":id/read")
  @HttpCode(204)
  @ApiOperation({ summary: "Mark one inbox item read for the caller" })
  @ApiParam({ name: "id", schema: { type: "string" }, description: "The approval line or entity id" })
  @ApiZodError(401, "No token, or a token that does not verify")
  read(@Param("id") id: string): Promise<void> {
    return this.inbox.markRead(id, new Date());
  }
}
