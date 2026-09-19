import { Injectable } from "@nestjs/common";
import { CalendarEntry, type CalendarQuery, type DisruptionHoursRow } from "@ecapital/shared";
import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { DISRUPTION_STATUSES, disruptionRows, type DisruptionPermit } from "./calendar-rows";
import { CALENDAR_STATUSES } from "./permit-rows";

/**
 * M3 — «Ημερολόγιο κλινικής διατάραξης», the network-wide disruption calendar
 * (R25, CAPEX-01 §2 and §6.7), and §11's theatre and ICU hours lost.
 *
 * CAPEX-01 §2 calls the calendar one of the three things «nothing on the
 * market does for a network like ΟΚΥπΥ»: «one calendar across all nine
 * hospitals showing every planned works-driven closure or degradation of a
 * clinical area. Clinical management sees it before it happens, not on the
 * morning it starts.»
 *
 * «Across all nine hospitals» needs no code here. Central Administration
 * carries every unit id on its token, so the row policies hand it every unit
 * and a hospital's own staff get their own (ADR-0010). The one narrow rule is
 * §9's, and it is a policy too: a clinical approver sees the permits that
 * touch their areas and nothing else, on the calendar as everywhere else.
 */
@Injectable()
export class CalendarService {
  /**
   * RULE (R25): the calendar shows what is agreed or in progress —
   * CLINICAL_REVIEW, APPROVED, ACTIVE and BREACH. A draft is nobody's
   * business yet; a rejected permit is not happening; a closed one is history
   * and belongs in §11's report rather than on next week's grid.
   */
  async entries(query: CalendarQuery): Promise<CalendarEntry[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T23:59:59.999Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      throw AppError.badRequest("errors.calendarQueryNotValid");
    }

    const clauses: SQL[] = [
      inArray(schema.shutdownPermit.status, CALENDAR_STATUSES),
      // Anything whose window overlaps the asked-for one.
      lte(schema.shutdownPermit.plannedStart, to),
      gte(schema.shutdownPermit.plannedEnd, from),
    ];
    if (query.orgUnitId) clauses.push(eq(schema.shutdownPermit.orgUnitId, query.orgUnitId));
    if (query.system) {
      clauses.push(
        sql`${query.system}::ecapital.permit_system = any (${schema.shutdownPermit.systems})`,
      );
    }
    if (query.areaType) {
      clauses.push(
        sql`exists (select 1 from ecapital.shutdown_permit_area spa
                     join ecapital.area a on a.id = spa.area_id
                    where spa.permit_id = ${schema.shutdownPermit.id}
                      and a.area_type = ${query.areaType}::ecapital.area_type)`,
      );
    }

    const rows = await tx.db
      .select({
        permitId: schema.shutdownPermit.id,
        permitRef: schema.shutdownPermit.ref,
        orgUnitId: schema.shutdownPermit.orgUnitId,
        orgUnitCode: schema.orgUnit.code,
        titleEl: schema.shutdownPermit.titleEl,
        systems: schema.shutdownPermit.systems,
        start: schema.shutdownPermit.plannedStart,
        end: schema.shutdownPermit.plannedEnd,
        icraClass: schema.shutdownPermit.icraClass,
        status: schema.shutdownPermit.status,
        clashes: schema.shutdownPermit.clashes,
      })
      .from(schema.shutdownPermit)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.shutdownPermit.orgUnitId))
      .where(and(...clauses))
      .orderBy(asc(schema.shutdownPermit.plannedStart), asc(schema.shutdownPermit.id));
    if (!rows.length) return [];

    const areas = await tx.db
      .select({
        permitId: schema.shutdownPermitArea.permitId,
        areaId: schema.shutdownPermitArea.areaId,
        areaType: schema.area.areaType,
        nameEl: schema.area.nameEl,
      })
      .from(schema.shutdownPermitArea)
      .innerJoin(schema.area, eq(schema.area.id, schema.shutdownPermitArea.areaId))
      .where(
        inArray(
          schema.shutdownPermitArea.permitId,
          rows.map((row) => row.permitId),
        ),
      )
      .orderBy(asc(schema.area.code));

    return rows.map((row) => {
      const mine = areas.filter((area) => area.permitId === row.permitId);
      return CalendarEntry.parse({
        permitId: row.permitId,
        permitRef: row.permitRef,
        orgUnitId: row.orgUnitId,
        orgUnitCode: row.orgUnitCode,
        titleEl: row.titleEl,
        systems: row.systems,
        areaIds: mine.map((area) => area.areaId),
        areaTypes: mine.map((area) => area.areaType),
        areaNamesEl: mine.map((area) => area.nameEl),
        start: row.start.toISOString(),
        end: row.end.toISOString(),
        icraClass: row.icraClass,
        status: row.status,
        // RULE (§6.7): the clash was found and stored at submission. The
        // calendar reads it rather than recomputing it, so the chip on the
        // grid and the warning on the record say the same thing.
        hasClash: Array.isArray(row.clashes) && row.clashes.length > 0,
      });
    });
  }

  /**
   * §11: theatre and ICU hours lost to planned works, by unit and month.
   *
   * RULE: the real window where the permit has one — a job that started two
   * hours late and ran four hours long cost what it cost — and the planned
   * window until it does.
   */
  async disruptionHours(year: number): Promise<DisruptionHoursRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));

    const rows = await tx.db
      .select({
        permitId: schema.shutdownPermit.id,
        orgUnitId: schema.shutdownPermit.orgUnitId,
        orgUnitNameEl: schema.orgUnit.nameEl,
        plannedStart: schema.shutdownPermit.plannedStart,
        plannedEnd: schema.shutdownPermit.plannedEnd,
        actualStart: schema.shutdownPermit.actualStart,
        actualEnd: schema.shutdownPermit.actualEnd,
        touchesTheatre: sql<boolean>`exists (
          select 1 from ecapital.shutdown_permit_area spa
            join ecapital.area a on a.id = spa.area_id
           where spa.permit_id = ${schema.shutdownPermit.id} and a.area_type = 'THEATRE')`,
        touchesIcu: sql<boolean>`exists (
          select 1 from ecapital.shutdown_permit_area spa
            join ecapital.area a on a.id = spa.area_id
           where spa.permit_id = ${schema.shutdownPermit.id} and a.area_type = 'ICU')`,
      })
      .from(schema.shutdownPermit)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.shutdownPermit.orgUnitId))
      .where(
        and(
          inArray(schema.shutdownPermit.status, DISRUPTION_STATUSES),
          lte(schema.shutdownPermit.plannedStart, to),
          gte(schema.shutdownPermit.plannedEnd, from),
        ),
      );

    const permits: DisruptionPermit[] = rows
      .filter((row) => row.touchesTheatre || row.touchesIcu)
      .map((row) => ({
        permitId: row.permitId,
        orgUnitId: row.orgUnitId,
        orgUnitNameEl: row.orgUnitNameEl,
        start: row.actualStart ?? row.plannedStart,
        // A permit that started and has not ended yet is still costing hours;
        // the planned end is the honest estimate of when it stops.
        end: row.actualEnd ?? row.plannedEnd,
        touchesTheatre: row.touchesTheatre,
        touchesIcu: row.touchesIcu,
      }));

    return disruptionRows(permits, year);
  }
}
