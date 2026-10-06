/**
 * M5 — the preventive programme and the pass that turns it into orders
 * (R32, R33; ADR-0031 §3–4).
 *
 * «A month of PM work orders generate, dispatch and close without a
 * spreadsheet» is the M5 definition of done, and this is the generating
 * half. One pass does two things, in the caller's transaction:
 *
 *  (a) every active line whose `next_due` is inside its lead time and that
 *      has no open PM order gets one, and its `next_due` moves on by the
 *      frequency (the contract's `nextDueAfter`);
 *  (b) every corrective or statutory call still OPEN past its response
 *      deadline, unescalated, is stamped `escalated_at` once and gets an
 *      ESCALATED line in its story.
 *
 * The same pass runs from «Έκδοση τώρα» (`POST /maintenance/schedules/
 * generate`, as the caller, under the caller's row policies) and from the
 * hourly sweep (maintenance-sweep.service.ts, as `scheduler:maintenance`).
 * Both are idempotent: one open PM order per schedule, enforced here and by
 * a partial unique index, and an escalation stamp that is only ever set on
 * a row where it is null.
 *
 * No permission check here (ADR-0010): the policies decide which lines and
 * orders the caller's pass can see and change.
 */
import { Injectable } from "@nestjs/common";
import {
  type PmGenerationResult,
  type PmSchedule,
  type PmScheduleWrite,
  nextDueAfter,
} from "@ecapital/shared";
import { and, asc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { writeError } from "./contracts.service";
import { addDays, nicosiaYear, pmDeadlines, todayInNicosia } from "./maintenance-rules";
import { OPEN_PM_STATUSES, toPmSchedule } from "./maintenance-rows";

export interface ScheduleQuery {
  orgUnitId?: string;
  maintenanceContractId?: string;
  active?: boolean;
}

@Injectable()
export class SchedulesService {
  // ------------------------------------------------------------ the list --

  async list(query: ScheduleQuery): Promise<PmSchedule[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const filters: SQL[] = [];
    if (query.orgUnitId) filters.push(eq(schema.pmSchedule.orgUnitId, query.orgUnitId));
    if (query.maintenanceContractId) {
      if (!UUID.test(query.maintenanceContractId)) return [];
      filters.push(eq(schema.pmSchedule.maintenanceContractId, query.maintenanceContractId));
    }
    if (query.active !== undefined) filters.push(eq(schema.pmSchedule.active, query.active));
    return this.select(filters.length ? and(...filters) : undefined);
  }

  async detail(id: string): Promise<PmSchedule> {
    if (!UUID.test(id)) throw AppError.notFound("errors.pmScheduleNotFound");
    const [row] = await this.select(eq(schema.pmSchedule.id, id));
    if (!row) throw AppError.notFound("errors.pmScheduleNotFound");
    return row;
  }

  private async select(where: SQL | undefined): Promise<PmSchedule[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        schedule: schema.pmSchedule,
        slaSystemCode: schema.slaSystem.code,
        slaSystemName: schema.slaSystem.nameEl,
        assetTag: schema.asset.tag,
        assetName: schema.asset.nameEl,
        openWorkOrderId: sql<string | null>`(
          select w.id from ecapital.work_order w
           where w.pm_schedule_id = ${schema.pmSchedule.id}
             and w.status in ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PAUSED')
           limit 1)`,
      })
      .from(schema.pmSchedule)
      .innerJoin(schema.slaSystem, eq(schema.slaSystem.id, schema.pmSchedule.slaSystemId))
      .leftJoin(schema.asset, eq(schema.asset.id, schema.pmSchedule.assetId))
      .where(where)
      .orderBy(asc(schema.pmSchedule.nextDue), asc(schema.pmSchedule.titleEl));
    return rows.map((row) =>
      toPmSchedule(row.schedule, {
        slaSystemCode: row.slaSystemCode,
        slaSystemName: row.slaSystemName,
        assetTag: row.assetTag,
        assetName: row.assetName,
        openWorkOrderId: row.openWorkOrderId,
      }),
    );
  }

  // ----------------------------------------------------------- the write --

  /** The agreement is the system's: the caller names the line, the database fills the rest. */
  async create(input: PmScheduleWrite): Promise<PmSchedule> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const system = await this.system(input.slaSystemId);
    await this.checkAsset(system.orgUnitId, input.assetId ?? null);
    try {
      const [row] = await tx.db
        .insert(schema.pmSchedule)
        .values({
          // Both overwritten by the inherit trigger from the system; named
          // here because the columns are NOT NULL.
          maintenanceContractId: system.maintenanceContractId,
          orgUnitId: system.orgUnitId,
          slaSystemId: system.id,
          assetId: input.assetId ?? null,
          titleEl: input.titleEl.trim(),
          frequency: input.frequency,
          checklistEl: input.checklistEl ?? null,
          nextDue: input.nextDue.slice(0, 10),
          leadDays: input.leadDays ?? 14,
          active: input.active ?? true,
        })
        .returning({ id: schema.pmSchedule.id });
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");
      return await this.detail(row.id);
    } catch (error) {
      throw writeError(error, "errors.pmScheduleNotValid", "errors.pmScheduleNotValid");
    }
  }

  async update(id: string, patch: Partial<PmScheduleWrite>): Promise<PmSchedule> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.pmScheduleNotFound");
    const [existing] = await tx.db
      .select()
      .from(schema.pmSchedule)
      .where(eq(schema.pmSchedule.id, id))
      .limit(1);
    if (!existing) throw AppError.notFound("errors.pmScheduleNotFound");

    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    if (patch.slaSystemId !== undefined && patch.slaSystemId !== existing.slaSystemId) {
      // Another line of the same hospital's catalogue. A line of another
      // unit is not somewhere this schedule can go.
      const system = await this.system(patch.slaSystemId);
      if (system.orgUnitId !== existing.orgUnitId) {
        throw AppError.notFound("errors.slaSystemNotFound");
      }
      values.slaSystemId = system.id;
    }
    if (patch.assetId !== undefined) {
      await this.checkAsset(existing.orgUnitId, patch.assetId ?? null);
      values.assetId = patch.assetId ?? null;
    }
    if (patch.titleEl !== undefined) values.titleEl = patch.titleEl.trim();
    if (patch.frequency !== undefined) values.frequency = patch.frequency;
    if (patch.checklistEl !== undefined) values.checklistEl = patch.checklistEl ?? null;
    if (patch.nextDue !== undefined) values.nextDue = patch.nextDue.slice(0, 10);
    if (patch.leadDays !== undefined) values.leadDays = patch.leadDays;
    if (patch.active !== undefined) values.active = patch.active;

    try {
      const touched = await tx.db
        .update(schema.pmSchedule)
        .set(values)
        .where(eq(schema.pmSchedule.id, id))
        .returning({ id: schema.pmSchedule.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return await this.detail(id);
    } catch (error) {
      throw writeError(error, "errors.pmScheduleNotValid", "errors.pmScheduleNotValid");
    }
  }

  // ------------------------------------------------------------ the pass --

  /**
   * One pass at `now`. `raisedBy` is the person who pressed «Έκδοση τώρα»,
   * or null from the hourly sweep — the order then reads «Σύστημα» as its
   * raiser and the audit trail carries `scheduler:maintenance`.
   */
  async generate(now: Date, raisedBy: string | null): Promise<PmGenerationResult> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const today = todayInNicosia(now);
    const result: PmGenerationResult = { generated: 0, skippedOpen: 0, escalated: 0 };

    // (a) the programme. Due inside the lead time: next_due − lead_days ≤ today.
    const due = await tx.db
      .select({
        schedule: schema.pmSchedule,
        band: schema.slaSystem.band,
        areaId: schema.asset.areaId,
      })
      .from(schema.pmSchedule)
      .innerJoin(schema.slaSystem, eq(schema.slaSystem.id, schema.pmSchedule.slaSystemId))
      .innerJoin(
        schema.maintenanceContract,
        eq(schema.maintenanceContract.id, schema.pmSchedule.maintenanceContractId),
      )
      .leftJoin(schema.asset, eq(schema.asset.id, schema.pmSchedule.assetId))
      .where(
        and(
          eq(schema.pmSchedule.active, true),
          eq(schema.maintenanceContract.status, "ACTIVE"),
          sql`${schema.pmSchedule.nextDue} - ${schema.pmSchedule.leadDays} <= ${today}::date`,
        ),
      )
      .orderBy(asc(schema.pmSchedule.nextDue));

    for (const { schedule, band, areaId } of due) {
      const [open] = await tx.db
        .select({ id: schema.workOrder.id })
        .from(schema.workOrder)
        .where(
          and(
            eq(schema.workOrder.pmScheduleId, schedule.id),
            inArray(schema.workOrder.status, [...OPEN_PM_STATUSES]),
          ),
        )
        .limit(1);
      if (open) {
        result.skippedOpen += 1;
        continue;
      }

      const deadlines = pmDeadlines(schedule.nextDue);
      const [allocated] = await tx.db
        .select({
          ref: sql<string>`ecapital.allocate_work_order_ref(${schedule.orgUnitId}::text, ${nicosiaYear(now)}::integer)`,
        })
        .from(sql`(select 1) as one`);
      const [order] = await tx.db
        .insert(schema.workOrder)
        .values({
          ref: allocated.ref,
          orgUnitId: schedule.orgUnitId,
          kind: "PM",
          status: "OPEN",
          source: "PM_PROGRAMME",
          maintenanceContractId: schedule.maintenanceContractId,
          slaSystemId: schedule.slaSystemId,
          band,
          assetId: schedule.assetId,
          areaId: areaId ?? null,
          pmScheduleId: schedule.id,
          titleEl: schedule.titleEl,
          calledAt: now,
          dueDate: schedule.nextDue,
          dueRestoreBaseAt: new Date(deadlines.dueRestoreAt),
          dueRestoreAt: new Date(deadlines.dueRestoreAt),
          dueReportAt: new Date(deadlines.dueReportAt),
          raisedBy,
        })
        // The partial unique index is the second lock: a pass running at the
        // same moment in another transaction issues nothing twice.
        .onConflictDoNothing()
        .returning({ id: schema.workOrder.id });
      if (!order) {
        result.skippedOpen += 1;
        continue;
      }
      await tx.db.insert(schema.workOrderEvent).values({
        workOrderId: order.id,
        orgUnitId: schedule.orgUnitId,
        at: now,
        byId: raisedBy,
        kind: "CREATED",
        noteEl: `Πρόγραμμα προληπτικής συντήρησης, ημερομηνία ${dateOnlyEl(schedule.nextDue)}`,
      });

      const touched = await tx.db
        .update(schema.pmSchedule)
        .set({
          nextDue: nextDueAfter(schedule.nextDue, schedule.frequency),
          lastGeneratedAt: now,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.pmSchedule.id, schedule.id))
        .returning({ id: schema.pmSchedule.id });
      // The order went in and the line did not move: the caller may raise but
      // not keep the programme. Refuse the whole pass rather than leave a
      // line that would issue the same visit again next hour.
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      result.generated += 1;
    }

    // (b) escalation (ADR-0031 §4): a flag, once, never a message yet.
    const late = await tx.db
      .update(schema.workOrder)
      .set({ escalatedAt: now, updatedAt: sql`now()` })
      .where(
        and(
          inArray(schema.workOrder.kind, ["CORRECTIVE", "STATUTORY"]),
          eq(schema.workOrder.status, "OPEN"),
          isNull(schema.workOrder.respondedAt),
          isNull(schema.workOrder.escalatedAt),
          lt(schema.workOrder.dueResponseAt, now),
        ),
      )
      .returning({ id: schema.workOrder.id, orgUnitId: schema.workOrder.orgUnitId });
    for (const order of late) {
      await tx.db.insert(schema.workOrderEvent).values({
        workOrderId: order.id,
        orgUnitId: order.orgUnitId,
        at: now,
        byId: raisedBy,
        kind: "ESCALATED",
        noteEl: "Ο χρόνος ανταπόκρισης έληξε χωρίς ανταπόκριση του αναδόχου.",
      });
    }
    result.escalated = late.length;
    return result;
  }

  // ---------------------------------------------------------- internals --

  private async system(id: string) {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.slaSystemNotFound");
    const [row] = await tx.db
      .select()
      .from(schema.slaSystem)
      .where(eq(schema.slaSystem.id, id))
      .limit(1);
    if (!row) throw AppError.notFound("errors.slaSystemNotFound");
    return row;
  }

  private async checkAsset(orgUnitId: string, assetId: string | null): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!assetId) return;
    if (!UUID.test(assetId)) throw AppError.notFound("errors.assetNotFound");
    const [row] = await tx.db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(and(eq(schema.asset.id, assetId), eq(schema.asset.orgUnitId, orgUnitId)))
      .limit(1);
    if (!row) throw AppError.notFound("errors.assetNotFound");
  }
}

function dateOnlyEl(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Exported for the summary: the first and last day of the Nicosia month `now` is in. */
export function monthOf(now: Date): { first: string; next: string } {
  const today = todayInNicosia(now);
  const first = `${today.slice(0, 7)}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { first, next: addDays(d.toISOString().slice(0, 10), 0) };
}
