import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AreaType, CalendarEntry, CalendarQuery, DisruptionHoursRow, PermitSystem } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { CalendarService } from "./calendar.service";

const Query_ = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orgUnitId: z.string().optional(),
  areaType: AreaType.optional(),
  system: PermitSystem.optional(),
});

const YearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

/**
 * M3 — the network-wide clinical disruption calendar (R25) and §11's report.
 *
 * Both are read-only and neither checks a unit: Central Administration sees
 * every hospital because its token carries every unit id, a hospital's staff
 * see their own, and a clinical approver sees the permits that touch their
 * areas — all three decided by the row policies (ADR-0010, §9).
 */
@ApiTags("permits")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @ApiOperation({ summary: "Every agreed or running shutdown in the window, across the network" })
  @ApiQuery({ name: "from", required: true, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "to", required: true, description: "YYYY-MM-DD" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiQuery({ name: "areaType", required: false })
  @ApiQuery({ name: "system", required: false })
  @ApiZodResponse(200, z.array(CalendarEntry), "The entries, earliest first")
  @ApiZodError(400, "The window is not two dates, or runs backwards")
  @ApiZodError(401, "No token, or a token that does not verify")
  entries(@Query() query: unknown): Promise<CalendarEntry[]> {
    const parsed = Query_.safeParse(query);
    if (!parsed.success) throw AppError.badRequest("errors.calendarQueryNotValid");
    return this.calendar.entries(CalendarQuery.parse(parsed.data));
  }

  /** CAPEX-01 §11: theatre and ICU hours lost to planned works, by unit and month. */
  @Get("disruption-hours")
  @ApiOperation({ summary: "Theatre and ICU hours lost to planned works, by unit and month" })
  @ApiQuery({ name: "year", required: true, description: "YYYY" })
  @ApiZodResponse(200, z.array(DisruptionHoursRow), "One row per unit per month with hours in it")
  @ApiZodError(400, "The year is missing or not a year")
  disruptionHours(@Query() query: unknown): Promise<DisruptionHoursRow[]> {
    const parsed = YearQuery.safeParse(query);
    if (!parsed.success) throw AppError.badRequest("errors.calendarQueryNotValid");
    return this.calendar.disruptionHours(parsed.data.year);
  }
}
