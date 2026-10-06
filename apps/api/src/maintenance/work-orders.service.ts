/**
 * M5 — Εντολές εργασίας: the call, its three clocks, its coding and its
 * story (R33, R34, R36; ADR-0031 §3–8).
 *
 * RULE (contract note *): every timer counts from the moment the call was
 * sent. `calledAt` is the one input; the three deadlines are computed from
 * the catalogue line at the call and stored, so a later edit of the
 * catalogue never rewrites what an order was promised. The state of each
 * timer is computed on read (`workOrderSla`).
 *
 * There is no permission check in this file and there is not meant to be one
 * (ADR-0010). Raising is `can_raise_work_order` (the clinical approver
 * included, because the nursing team is who notices); working —
 * transitions, codes, costs, extensions — is `can_work_work_order`. Both are
 * row policies; the `@Roles` on the routes are the second lock.
 *
 * NO PATIENT DATA. A machine, a room, a clock and the name of the member of
 * staff who called it in.
 */
import { Injectable } from "@nestjs/common";
import {
  type BacklogCreate,
  type BacklogItem,
  type MaintenanceSummary,
  type WorkOrder,
  type WorkOrderCreate,
  type WorkOrderDetail,
  type WorkOrderEvent,
  type WorkOrderEventKind,
  type WorkOrderListQuery,
  type WorkOrderListRow,
  type WorkOrderPatch,
  type WorkOrderTransition,
  WORK_ORDER_ACTION_TARGET,
  WORK_ORDER_TRANSITIONS,
  addHours,
} from "@ecapital/shared";
import { and, asc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { DocumentsService, type UploadInput } from "../documents/documents.service";
import { BacklogService } from "./backlog.service";
import {
  addWorkingDays,
  historyText,
  nicosiaYear,
  replacementRule,
  riskBandForCriticality,
} from "./maintenance-rules";
import {
  type OrderJoined,
  SYSTEM_NAME_EL,
  iso,
  money,
  num,
  orderColumns,
  slaStateSql,
  toWorkOrder,
} from "./maintenance-rows";
import { monthOf } from "./schedules.service";

type OrderRow = typeof schema.workOrder.$inferSelect;
type SystemRow = typeof schema.slaSystem.$inferSelect;

/** A clock a phone and a server disagree on by a minute is not a future event. */
const CLOCK_SKEW_MS = 60_000;

/** The R36 window. */
const TWELVE_MONTHS = "12 months";

const ACTION_EVENT: Record<WorkOrderTransition["action"], WorkOrderEventKind> = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  START: "STARTED",
  PAUSE: "PAUSED",
  RESUME: "RESUMED",
  RESTORE: "RESTORED",
  COMPLETE: "COMPLETED",
  CANCEL: "CANCELLED",
};

/** The list query once the controller has coerced the strings. */
export type ListQuery = WorkOrderListQuery & { page: number; pageSize: number };

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly backlog: BacklogService,
  ) {}

  // ------------------------------------------------------------ the list --

  async list(query: ListQuery): Promise<{ items: WorkOrderListRow[]; total: number }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const now = new Date().toISOString();
    const w = schema.workOrder;

    const filters: SQL[] = [];
    if (query.orgUnitId) filters.push(eq(w.orgUnitId, query.orgUnitId));
    if (query.kind) filters.push(eq(w.kind, query.kind));
    if (query.status?.length) filters.push(inArray(w.status, query.status));
    if (query.band) filters.push(eq(w.band, query.band));
    for (const [value, column] of [
      [query.assetId, w.assetId],
      [query.slaSystemId, w.slaSystemId],
      [query.maintenanceContractId, w.maintenanceContractId],
    ] as const) {
      if (value === undefined) continue;
      if (!UUID.test(value)) return { items: [], total: 0 };
      filters.push(eq(column, value));
    }
    if (query.mine) filters.push(eq(w.raisedBy, await callerUserId()));
    if (query.from) filters.push(gte(w.calledAt, startOfDay(query.from)));
    if (query.to) filters.push(lt(w.calledAt, startOfDay(query.to)));
    if (query.slaState) filters.push(slaStateSql(query.slaState, now));
    if (query.q?.trim()) {
      // ecapital.normalise folds Greek case and accents, which lower() does
      // not do under every collation the database may run with.
      const needle = sql`'%' || ecapital.normalise(${query.q.trim()}) || '%'`;
      filters.push(
        sql`(ecapital.normalise(${w.ref}) like ${needle}
             or ecapital.normalise(${w.titleEl}) like ${needle}
             or ecapital.normalise(coalesce(${schema.asset.tag}, '')) like ${needle}
             or ecapital.normalise(coalesce(${schema.asset.nameEl}, '')) like ${needle})`,
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    // The count needs the asset join only: `q` reads the tag and the name.
    const [{ total }] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(w)
      .leftJoin(schema.asset, eq(schema.asset.id, w.assetId))
      .where(where);

    const dir = query.dir === "asc" ? "asc" : "desc";
    const order: SQL =
      query.sort === "ref"
        ? sql`${w.ref} ${sql.raw(dir)}`
        : query.sort === "status"
          ? sql`${w.status} ${sql.raw(dir)}`
          : query.sort === "band"
            ? sql`${w.band} ${sql.raw(dir === "asc" ? "desc" : "asc")} nulls last`
            : query.sort === "dueRestoreAt"
              ? sql`${w.dueRestoreAt} ${sql.raw(dir)} nulls last`
              : sql`${w.calledAt} ${sql.raw(dir)}`;

    const rows = await this.selectOrders()
      .where(where)
      // Second key so a page boundary is stable when the first key ties.
      .orderBy(order, asc(w.ref))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: rows.map((row) => toListRow(toWorkOrder(row, now))),
      total,
    };
  }

  /** An order with the joins every read of one carries: agreement, contractor, line, asset, room. */
  private selectOrders() {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    return tx.db
      .select(orderColumns)
      .from(schema.workOrder)
      .leftJoin(
        schema.maintenanceContract,
        eq(schema.maintenanceContract.id, schema.workOrder.maintenanceContractId),
      )
      .leftJoin(schema.contractor, eq(schema.contractor.id, schema.maintenanceContract.contractorId))
      .leftJoin(schema.slaSystem, eq(schema.slaSystem.id, schema.workOrder.slaSystemId))
      .leftJoin(schema.asset, eq(schema.asset.id, schema.workOrder.assetId))
      .leftJoin(schema.area, eq(schema.area.id, schema.workOrder.areaId));
  }

  // ---------------------------------------------------------- the detail --

  async detail(id: string): Promise<WorkOrderDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const now = new Date().toISOString();
    const joined = await this.joinedRow(id);
    const order = toWorkOrder(joined, now);

    const events = await tx.db
      .select({
        event: schema.workOrderEvent,
        byName: sql<string | null>`ecapital.user_display_name(${schema.workOrderEvent.byId})`,
        documentTitle: schema.document.titleEl,
      })
      .from(schema.workOrderEvent)
      .leftJoin(schema.document, eq(schema.document.id, schema.workOrderEvent.documentId))
      .where(eq(schema.workOrderEvent.workOrderId, id))
      .orderBy(asc(schema.workOrderEvent.at), asc(schema.workOrderEvent.createdAt));

    let checklistEl: string | null = null;
    if (joined.order.pmScheduleId) {
      const [schedule] = await tx.db
        .select({ checklistEl: schema.pmSchedule.checklistEl })
        .from(schema.pmSchedule)
        .where(eq(schema.pmSchedule.id, joined.order.pmScheduleId))
        .limit(1);
      checklistEl = schedule?.checklistEl ?? null;
    }

    let repeatCount = 0;
    if (joined.order.assetId) {
      const [row] = await tx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.workOrder)
        .where(
          and(
            eq(schema.workOrder.assetId, joined.order.assetId),
            eq(schema.workOrder.kind, "CORRECTIVE"),
            ne(schema.workOrder.status, "CANCELLED"),
            sql`${schema.workOrder.calledAt} >= now() - ${TWELVE_MONTHS}::interval`,
          ),
        );
      repeatCount = row?.n ?? 0;
    } else if (joined.order.kind === "CORRECTIVE") {
      repeatCount = 1;
    }

    return {
      ...order,
      events: events.map((e) => toEvent(e.event, e.byName, e.documentTitle)),
      checklistEl,
      repeatCount,
    };
  }

  // ------------------------------------------------------------ the call --

  /**
   * S20, phone-first. The unit comes from the asset, or from the body when
   * there is no asset; the catalogue line from the body, or — when the
   * asset's class matches exactly one active line of the unit's active
   * agreement — from the asset. No line, no timers: an order is still an
   * order, it just has nothing to be late against.
   */
  async create(input: WorkOrderCreate): Promise<WorkOrder> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const nowDate = new Date();

    const asset = input.assetId ? await this.asset(input.assetId) : null;
    const unit = asset?.orgUnitId ?? input.orgUnitId;
    if (!unit) throw AppError.badRequest("errors.workOrderNeedsUnit");
    if (asset && input.orgUnitId && input.orgUnitId !== asset.orgUnitId) {
      throw AppError.badRequest("errors.workOrderUnitMismatch");
    }
    await this.checkUnit(unit);

    let system: SystemRow | null = null;
    if (input.slaSystemId) {
      system = await this.system(input.slaSystemId);
      if (system.orgUnitId !== unit) throw AppError.badRequest("errors.workOrderUnitMismatch");
    } else if (asset) {
      system = await this.systemForAsset(unit, asset.assetClass);
    }

    const areaId = input.areaId ?? asset?.areaId ?? null;
    if (input.areaId) await this.checkArea(unit, input.areaId);

    const calledAt = input.calledAt ? new Date(input.calledAt) : nowDate;
    if (calledAt.getTime() > nowDate.getTime() + CLOCK_SKEW_MS) {
      throw AppError.badRequest("errors.workOrderTimeNotValid");
    }
    const timers = system ? timersFrom(calledAt.toISOString(), system, 0) : null;
    const raisedBy = await callerUserId();

    try {
      const [allocated] = await tx.db
        .select({
          ref: sql<string>`ecapital.allocate_work_order_ref(${unit}::text, ${nicosiaYear(calledAt)}::integer)`,
        })
        .from(sql`(select 1) as one`);
      const [row] = await tx.db
        .insert(schema.workOrder)
        .values({
          ref: allocated.ref,
          orgUnitId: unit,
          kind: input.kind,
          status: "OPEN",
          source: input.source,
          maintenanceContractId: system?.maintenanceContractId ?? null,
          slaSystemId: system?.id ?? null,
          band: system?.band ?? null,
          assetId: asset?.id ?? null,
          areaId,
          titleEl: input.titleEl.trim(),
          descriptionEl: input.descriptionEl ?? null,
          calledAt,
          dueResponseAt: timers ? new Date(timers.dueResponseAt) : null,
          dueRestoreBaseAt: timers ? new Date(timers.dueRestoreBaseAt) : null,
          dueRestoreAt: timers ? new Date(timers.dueRestoreAt) : null,
          dueReportAt: timers ? new Date(timers.dueReportAt) : null,
          assignedToEl: input.assignedToEl ?? null,
          raisedBy,
        })
        .returning({ id: schema.workOrder.id });
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");
      // The story starts with the call, whenever it was typed in.
      await this.event(row.id, unit, "CREATED", raisedBy, null, calledAt);
      return toWorkOrder(await this.joinedRow(row.id), nowDate.toISOString());
    } catch (error) {
      throw orderWriteError(error);
    }
  }

  // ---------------------------------------------------------- the change --

  /**
   * A PATCH touches what it names. Three kinds of change write three kinds
   * of line in the story: an extension (contract note 2) is EXTENSION with
   * its reason, the codes are CODED, anything else is EDITED with the field
   * names.
   */
  async update(id: string, patch: WorkOrderPatch): Promise<WorkOrder> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    const nowDate = new Date();
    const by = await callerUserId();
    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    const edited: string[] = [];

    // The catalogue line: a correction of which system this is. The timers
    // follow it, from the same call, unless it is a PM order whose clock is
    // its programme date.
    let base = iso(existing.dueRestoreBaseAt) ?? iso(existing.dueRestoreAt);
    if (patch.slaSystemId !== undefined && patch.slaSystemId !== existing.slaSystemId) {
      const system = patch.slaSystemId ? await this.system(patch.slaSystemId) : null;
      if (system && system.orgUnitId !== existing.orgUnitId) {
        throw AppError.badRequest("errors.workOrderUnitMismatch");
      }
      values.slaSystemId = system?.id ?? null;
      values.band = system?.band ?? null;
      values.maintenanceContractId = system?.maintenanceContractId ?? null;
      if (existing.kind !== "PM") {
        const timers = system
          ? timersFrom(existing.calledAt.toISOString(), system, existing.extensionDays)
          : null;
        values.dueResponseAt = timers ? new Date(timers.dueResponseAt) : null;
        values.dueRestoreBaseAt = timers ? new Date(timers.dueRestoreBaseAt) : null;
        values.dueRestoreAt = timers ? new Date(timers.dueRestoreAt) : null;
        values.dueReportAt = timers ? new Date(timers.dueReportAt) : null;
        base = timers?.dueRestoreBaseAt ?? null;
      }
      edited.push("slaSystemId");
    }
    if (patch.assetId !== undefined && patch.assetId !== existing.assetId) {
      if (patch.assetId) {
        const asset = await this.asset(patch.assetId);
        if (asset.orgUnitId !== existing.orgUnitId) {
          throw AppError.badRequest("errors.workOrderUnitMismatch");
        }
      }
      values.assetId = patch.assetId ?? null;
      edited.push("assetId");
    }
    if (patch.areaId !== undefined && patch.areaId !== existing.areaId) {
      if (patch.areaId) await this.checkArea(existing.orgUnitId, patch.areaId);
      values.areaId = patch.areaId ?? null;
      edited.push("areaId");
    }
    for (const [key, column] of [
      ["titleEl", "titleEl"],
      ["descriptionEl", "descriptionEl"],
      ["assignedToEl", "assignedToEl"],
      ["partsNoteEl", "partsNoteEl"],
    ] as const) {
      const value = patch[key];
      if (value === undefined || value === existing[column]) continue;
      values[column] = key === "titleEl" ? String(value).trim() : (value ?? null);
      edited.push(key);
    }
    for (const key of ["costEstimate", "costActual"] as const) {
      const value = patch[key];
      if (value === undefined || value === num(existing[key])) continue;
      values[key] = money(value ?? null);
      edited.push(key);
    }

    // R34: the three codes.
    const coded: string[] = [];
    for (const key of ["failureCode", "causeCode", "remedyCode"] as const) {
      const value = patch[key];
      if (value === undefined || value === existing[key]) continue;
      values[key] = value ?? null;
      coded.push(`${key}=${value ?? "—"}`);
    }

    // Contract note 2: the restore deadline moves by working days from the
    // unextended one; the response deadline never moves.
    let extensionNote: string | null = null;
    const days = patch.extensionDays ?? existing.extensionDays;
    const reason =
      patch.extensionReasonEl !== undefined ? patch.extensionReasonEl : existing.extensionReasonEl;
    if (patch.extensionDays !== undefined || patch.extensionReasonEl !== undefined) {
      if (days > 0 && !reason?.trim()) {
        throw AppError.unprocessable("errors.workOrderExtensionNeedsReason");
      }
      if (days !== existing.extensionDays || (reason ?? null) !== existing.extensionReasonEl) {
        values.extensionDays = days;
        values.extensionReasonEl = reason?.trim() || null;
        if (days > 0) extensionNote = `${days} εργάσιμες ημέρες: ${reason?.trim()}`;
        else if (existing.extensionDays > 0) extensionNote = "Η παράταση αφαιρέθηκε.";
      }
    }
    if (base && (extensionNote !== null || values.dueRestoreBaseAt !== undefined)) {
      values.dueRestoreAt = new Date(addWorkingDays(base, days));
      if (values.dueRestoreBaseAt === undefined && !existing.dueRestoreBaseAt) {
        values.dueRestoreBaseAt = new Date(base);
      }
    }

    try {
      const touched = await tx.db
        .update(schema.workOrder)
        .set(values)
        .where(eq(schema.workOrder.id, id))
        .returning({ id: schema.workOrder.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      if (extensionNote) {
        await this.event(id, existing.orgUnitId, "EXTENSION", by, extensionNote, nowDate);
      }
      if (coded.length) {
        await this.event(id, existing.orgUnitId, "CODED", by, coded.join(", "), nowDate);
      }
      if (edited.length) {
        await this.event(id, existing.orgUnitId, "EDITED", by, edited.join(", "), nowDate);
      }
      return toWorkOrder(await this.joinedRow(id), nowDate.toISOString());
    } catch (error) {
      throw orderWriteError(error);
    }
  }

  // ------------------------------------------------------------ the step --

  async transition(id: string, body: WorkOrderTransition): Promise<WorkOrderDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);
    if (!WORK_ORDER_TRANSITIONS[existing.status].includes(body.action)) {
      throw AppError.conflict("errors.workOrderStepNotAllowed");
    }
    const nowDate = new Date();
    const at = body.at ? new Date(body.at) : nowDate;
    this.checkMoment(existing, at, nowDate);
    const by = await callerUserId();

    const values: Record<string, unknown> = {
      status: WORK_ORDER_ACTION_TARGET[body.action],
      updatedAt: sql`now()`,
    };
    const coded: string[] = [];
    switch (body.action) {
      case "ACKNOWLEDGE":
        values.respondedAt = at;
        break;
      case "START":
        values.startedAt = at;
        // Starting the work is responding to the call.
        if (!existing.respondedAt) values.respondedAt = at;
        break;
      case "RESTORE":
        values.restoredAt = at;
        break;
      case "COMPLETE": {
        const codes = {
          failureCode: body.failureCode ?? existing.failureCode,
          causeCode: body.causeCode ?? existing.causeCode,
          remedyCode: body.remedyCode ?? existing.remedyCode,
        };
        // RULE (R34, ADR-0031 §6): a corrective order cannot complete uncoded.
        if (
          existing.kind === "CORRECTIVE" &&
          (!codes.failureCode || !codes.causeCode || !codes.remedyCode)
        ) {
          throw AppError.unprocessable("errors.workOrderNeedsCodes");
        }
        for (const key of ["failureCode", "causeCode", "remedyCode"] as const) {
          if (body[key] && body[key] !== existing[key]) {
            values[key] = body[key];
            coded.push(`${key}=${body[key]}`);
          }
        }
        const report = body.reportReceivedAt ? new Date(body.reportReceivedAt) : at;
        if (body.reportReceivedAt) this.checkMoment(existing, report, nowDate);
        values.completedAt = at;
        values.reportReceivedAt = report;
        if (!existing.restoredAt) values.restoredAt = at;
        if (body.costActual !== undefined) values.costActual = money(body.costActual);
        if (body.noteEl?.trim()) values.closeoutNoteEl = body.noteEl.trim();
        break;
      }
      case "CANCEL":
        if (!body.noteEl?.trim()) throw AppError.unprocessable("errors.workOrderCancelNeedsReason");
        values.cancelledAt = at;
        break;
      case "PAUSE":
      case "RESUME":
        break;
    }

    try {
      const touched = await tx.db
        .update(schema.workOrder)
        .set(values)
        .where(and(eq(schema.workOrder.id, id), eq(schema.workOrder.status, existing.status)))
        .returning({ id: schema.workOrder.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      // The codes ride on the completion, so they are written first: the
      // story reads «coded, then completed».
      if (coded.length) {
        await this.event(id, existing.orgUnitId, "CODED", by, coded.join(", "), at);
      }
      await this.event(
        id,
        existing.orgUnitId,
        ACTION_EVENT[body.action],
        by,
        body.noteEl?.trim() || null,
        at,
      );
      if (body.action === "COMPLETE" && existing.kind === "CORRECTIVE" && existing.assetId) {
        await this.replacementCheck(existing, by, nowDate);
      }
    } catch (error) {
      throw orderWriteError(error);
    }
    return this.detail(id);
  }

  /** `at` is not before the call and not in the future (400). */
  private checkMoment(order: OrderRow, at: Date, now: Date): void {
    if (Number.isNaN(at.getTime())) throw AppError.badRequest("errors.workOrderTimeNotValid");
    if (at.getTime() < order.calledAt.getTime() || at.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      throw AppError.badRequest("errors.workOrderTimeNotValid");
    }
  }

  /**
   * R36, ADR-0031 §8: on completion of a corrective order on an asset, three
   * or more corrective orders on it in twelve months, or repair cost in those
   * months above half its replacement estimate, drafts one REPLACEMENT item
   * with the history — once per asset while an OPEN auto item exists. The
   * partial unique index makes «once» hold under a race too.
   */
  private async replacementCheck(order: OrderRow, by: string, now: Date): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const assetId = order.assetId as string;
    const [asset] = await tx.db
      .select({
        nameEl: schema.asset.nameEl,
        criticality: schema.asset.criticality,
        replacementCostEst: schema.asset.replacementCostEst,
      })
      .from(schema.asset)
      .where(eq(schema.asset.id, assetId))
      .limit(1);
    if (!asset) return;

    const history = await tx.db
      .select({
        ref: schema.workOrder.ref,
        calledAt: schema.workOrder.calledAt,
        cost: sql<string | null>`coalesce(${schema.workOrder.costActual}, ${schema.workOrder.costEstimate})`,
      })
      .from(schema.workOrder)
      .where(
        and(
          eq(schema.workOrder.assetId, assetId),
          eq(schema.workOrder.kind, "CORRECTIVE"),
          ne(schema.workOrder.status, "CANCELLED"),
          sql`${schema.workOrder.calledAt} >= ${now.toISOString()}::timestamptz - ${TWELVE_MONTHS}::interval`,
        ),
      )
      .orderBy(asc(schema.workOrder.calledAt));
    const lines = history.map((h) => ({
      ref: h.ref,
      calledAt: h.calledAt.toISOString(),
      cost: num(h.cost),
    }));
    const reason = replacementRule(lines, num(asset.replacementCostEst));
    if (!reason) return;

    const [open] = await tx.db
      .select({ id: schema.backlogItem.id })
      .from(schema.backlogItem)
      .where(
        and(
          eq(schema.backlogItem.assetId, assetId),
          eq(schema.backlogItem.autoDrafted, true),
          eq(schema.backlogItem.status, "OPEN"),
        ),
      )
      .limit(1);
    if (open) return;

    const [item] = await tx.db
      .insert(schema.backlogItem)
      .values({
        orgUnitId: order.orgUnitId,
        kind: "REPLACEMENT",
        titleEl: `Αντικατάσταση: ${asset.nameEl}`.slice(0, 200),
        descriptionEl:
          reason === "THREE_CORRECTIVE_IN_12_MONTHS"
            ? "Τρεις ή περισσότερες διορθωτικές εντολές στο ίδιο πάγιο μέσα σε δώδεκα μήνες."
            : "Το κόστος επισκευών των τελευταίων δώδεκα μηνών ξεπερνά το επιτρεπόμενο ποσοστό της εκτίμησης κόστους αντικατάστασης.",
        riskBand: riskBandForCriticality(asset.criticality),
        costEstimate: asset.replacementCostEst,
        assetId,
        slaSystemId: order.slaSystemId,
        sourceWorkOrderId: order.id,
        autoDrafted: true,
        autoReason: reason,
        historyEl: historyText(lines),
        status: "OPEN",
        raisedBy: null,
        raisedAt: now,
      })
      .onConflictDoNothing({
        target: schema.backlogItem.assetId,
        where: sql`auto_drafted and status = 'OPEN' and asset_id is not null`,
      })
      .returning({ id: schema.backlogItem.id });
    if (!item) return;

    await tx.db
      .update(schema.workOrder)
      .set({ backlogItemId: item.id, updatedAt: sql`now()` })
      .where(eq(schema.workOrder.id, order.id));
    await this.event(
      order.id,
      order.orgUnitId,
      "TO_BACKLOG",
      by,
      reason === "THREE_CORRECTIVE_IN_12_MONTHS"
        ? "Αυτόματη πρόταση αντικατάστασης: τρεις διορθωτικές εντολές σε δώδεκα μήνες."
        : "Αυτόματη πρόταση αντικατάστασης: το κόστος επισκευών ξεπέρασε το όριο.",
      now,
    );
  }

  // ------------------------------------------------- notes, photos, R35 --

  async addNote(id: string, noteEl: string): Promise<WorkOrderEvent> {
    const order = await this.row(id);
    const by = await callerUserId();
    try {
      const row = await this.event(id, order.orgUnitId, "NOTE", by, noteEl.trim(), new Date());
      return this.eventOut(row.id);
    } catch (error) {
      throw orderWriteError(error);
    }
  }

  /**
   * ADR-0031 §11: the file goes to eArchive through the outbox, by the same
   * service and in the same transaction as every other document, and the
   * order's story gets a PHOTO line pointing at it.
   */
  async addDocument(id: string, upload: UploadInput): Promise<WorkOrderEvent> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const joined = await this.joinedRow(id);
    const order = joined.order;
    const [unit] = await tx.db
      .select({ code: schema.orgUnit.code, nameEl: schema.orgUnit.nameEl })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, order.orgUnitId))
      .limit(1);
    if (!unit) throw AppError.notFound("errors.unitNotFound");

    const record = await this.documents.fileWorkOrderDocument(
      {
        id: order.id,
        ref: order.ref,
        titleEl: order.titleEl,
        orgUnitId: order.orgUnitId,
        unitCode: unit.code,
        unitName: unit.nameEl,
        assetTag: joined.assetTag,
        maintenanceContractId: order.maintenanceContractId,
        cost: num(order.costActual) ?? num(order.costEstimate),
      },
      upload,
    );
    const by = await callerUserId();
    try {
      const row = await this.event(
        id,
        order.orgUnitId,
        "PHOTO",
        by,
        record.titleEl,
        new Date(),
        record.id,
      );
      return this.eventOut(row.id);
    } catch (error) {
      throw orderWriteError(error);
    }
  }

  /** R35 from the order: the item defaults its asset, system and title from it. */
  async toBacklog(
    id: string,
    input: Omit<BacklogCreate, "orgUnitId" | "sourceWorkOrderId" | "titleEl"> & { titleEl?: string },
  ): Promise<BacklogItem> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const order = await this.row(id);
    const item = await this.backlog.create({
      ...input,
      orgUnitId: order.orgUnitId,
      titleEl: input.titleEl ?? order.titleEl,
      assetId: input.assetId === undefined ? order.assetId : input.assetId,
      slaSystemId: input.slaSystemId === undefined ? order.slaSystemId : input.slaSystemId,
      sourceWorkOrderId: order.id,
    });
    const by = await callerUserId();
    try {
      const touched = await tx.db
        .update(schema.workOrder)
        .set({ backlogItemId: item.id, updatedAt: sql`now()` })
        .where(eq(schema.workOrder.id, id))
        .returning({ id: schema.workOrder.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      await this.event(id, order.orgUnitId, "TO_BACKLOG", by, item.titleEl, new Date());
    } catch (error) {
      throw orderWriteError(error);
    }
    return item;
  }

  // ------------------------------------------------------------ the tiles --

  /** S18's tiles, over the units the caller may read (or one of them). */
  async summary(orgUnitId: string | null): Promise<MaintenanceSummary> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const now = new Date();
    const nowIso = now.toISOString();
    const { first, next } = monthOf(now);
    const w = schema.workOrder;
    const unit = orgUnitId ? sql`and ${w.orgUnitId} = ${orgUnitId}` : sql``;

    const [counts] = await tx.db
      .select({
        open: sql<number>`count(*) filter (where ${w.status} not in ('COMPLETED', 'CANCELLED'))::int`,
        overdueResponse: sql<number>`count(*) filter (
          where ${w.kind} <> 'PM' and ${w.status} not in ('COMPLETED', 'CANCELLED')
            and ${w.respondedAt} is null and ${w.dueResponseAt} < ${nowIso}::timestamptz)::int`,
        overdueRestore: sql<number>`count(*) filter (
          where ${w.kind} <> 'PM' and ${w.status} not in ('COMPLETED', 'CANCELLED')
            and ${w.restoredAt} is null and ${w.dueRestoreAt} < ${nowIso}::timestamptz)::int`,
        pmDueThisMonth: sql<number>`count(*) filter (
          where ${w.kind} = 'PM' and ${w.status} <> 'CANCELLED'
            and ${w.dueDate} >= ${first}::date and ${w.dueDate} < ${next}::date)::int`,
        pmOverdue: sql<number>`count(*) filter (
          where ${w.kind} = 'PM' and ${w.status} not in ('COMPLETED', 'CANCELLED')
            and ${w.dueRestoreAt} < ${nowIso}::timestamptz)::int`,
      })
      .from(w)
      .where(sql`true ${unit}`);

    const b = schema.backlogItem;
    const backlogUnit = orgUnitId ? sql`and ${b.orgUnitId} = ${orgUnitId}` : sql``;
    const [backlog] = await tx.db
      .select({ unfunded: sql<string>`coalesce(sum(${b.costEstimate}), 0)` })
      .from(b)
      .where(sql`${b.status} = 'OPEN' ${backlogUnit}`);

    return {
      open: counts?.open ?? 0,
      overdueResponse: counts?.overdueResponse ?? 0,
      overdueRestore: counts?.overdueRestore ?? 0,
      pmDueThisMonth: counts?.pmDueThisMonth ?? 0,
      pmOverdue: counts?.pmOverdue ?? 0,
      backlogUnfundedEur: Number(backlog?.unfunded ?? 0),
    };
  }

  // ---------------------------------------------------------- internals --

  async row(id: string): Promise<OrderRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.workOrderNotFound");
    const [row] = await tx.db
      .select()
      .from(schema.workOrder)
      .where(eq(schema.workOrder.id, id))
      .limit(1);
    if (!row) throw AppError.notFound("errors.workOrderNotFound");
    return row;
  }

  private async joinedRow(id: string): Promise<OrderJoined> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.workOrderNotFound");
    const [row] = await this.selectOrders().where(eq(schema.workOrder.id, id)).limit(1);
    if (!row) throw AppError.notFound("errors.workOrderNotFound");
    return row;
  }

  private async event(
    workOrderId: string,
    orgUnitId: string,
    kind: WorkOrderEventKind,
    byId: string | null,
    noteEl: string | null,
    at: Date,
    documentId: string | null = null,
  ): Promise<{ id: string }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .insert(schema.workOrderEvent)
      // clock_timestamp, not now(): two lines written in one transaction at
      // the same `at` keep the order they were written in.
      .values({
        workOrderId,
        orgUnitId,
        at,
        byId,
        kind,
        noteEl,
        documentId,
        createdAt: sql`clock_timestamp()`,
      })
      .returning({ id: schema.workOrderEvent.id });
    if (!row) throw AppError.forbidden("errors.readOnlyAccount");
    return row;
  }

  private async eventOut(id: string): Promise<WorkOrderEvent> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({
        event: schema.workOrderEvent,
        byName: sql<string | null>`ecapital.user_display_name(${schema.workOrderEvent.byId})`,
        documentTitle: schema.document.titleEl,
      })
      .from(schema.workOrderEvent)
      .leftJoin(schema.document, eq(schema.document.id, schema.workOrderEvent.documentId))
      .where(eq(schema.workOrderEvent.id, id))
      .limit(1);
    if (!row) throw AppError.internal();
    return toEvent(row.event, row.byName, row.documentTitle);
  }

  private async asset(id: string) {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.assetNotFound");
    const [row] = await tx.db
      .select({
        id: schema.asset.id,
        orgUnitId: schema.asset.orgUnitId,
        areaId: schema.asset.areaId,
        assetClass: schema.asset.assetClass,
      })
      .from(schema.asset)
      .where(eq(schema.asset.id, id))
      .limit(1);
    if (!row) throw AppError.notFound("errors.assetNotFound");
    return row;
  }

  private async system(id: string): Promise<SystemRow> {
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

  /**
   * The asset's class picks the line only when exactly one active line of the
   * unit's active agreements carries it. Two candidates is a choice for a
   * person, not for the server.
   */
  private async systemForAsset(
    orgUnitId: string,
    assetClass: SystemRow["assetClass"],
  ): Promise<SystemRow | null> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!assetClass) return null;
    const rows = await tx.db
      .select({ system: schema.slaSystem })
      .from(schema.slaSystem)
      .innerJoin(
        schema.maintenanceContract,
        eq(schema.maintenanceContract.id, schema.slaSystem.maintenanceContractId),
      )
      .where(
        and(
          eq(schema.slaSystem.orgUnitId, orgUnitId),
          eq(schema.slaSystem.assetClass, assetClass),
          eq(schema.slaSystem.active, true),
          eq(schema.maintenanceContract.status, "ACTIVE"),
        ),
      )
      .limit(2);
    return rows.length === 1 ? rows[0].system : null;
  }

  private async checkUnit(orgUnitId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ id: schema.orgUnit.id })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, orgUnitId))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.unitNotFound");
  }

  private async checkArea(orgUnitId: string, areaId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(areaId)) throw AppError.notFound("errors.workOrderAreaNotFound");
    const rows = await tx.db
      .select({ id: schema.area.id })
      .from(schema.area)
      .where(and(eq(schema.area.id, areaId), eq(schema.area.orgUnitId, orgUnitId)))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.workOrderAreaNotFound");
  }
}

// ------------------------------------------------------------ helpers --

/**
 * The three deadlines from the call (ADR-0031 §3), with the restore one
 * extended by the order's working days. `dueRestoreBaseAt` is the unextended
 * one, kept so a second extension replaces the first.
 */
export function timersFrom(
  calledAt: string,
  system: { responseHours: string; restoreHours: string; reportHours: string },
  extensionDays: number,
) {
  const dueRestoreBaseAt = addHours(calledAt, Number(system.restoreHours));
  return {
    dueResponseAt: addHours(calledAt, Number(system.responseHours)),
    dueRestoreBaseAt,
    dueRestoreAt: addWorkingDays(dueRestoreBaseAt, extensionDays),
    dueReportAt: addHours(calledAt, Number(system.reportHours)),
  };
}

function startOfDay(date: string): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`);
}

function toListRow(order: WorkOrder): WorkOrderListRow {
  return {
    id: order.id,
    ref: order.ref,
    orgUnitId: order.orgUnitId,
    kind: order.kind,
    status: order.status,
    source: order.source,
    band: order.band,
    slaSystemName: order.slaSystemName,
    assetTag: order.assetTag,
    assetName: order.assetName,
    areaName: order.areaName,
    titleEl: order.titleEl,
    calledAt: order.calledAt,
    dueResponseAt: order.dueResponseAt,
    dueRestoreAt: order.dueRestoreAt,
    dueReportAt: order.dueReportAt,
    dueDate: order.dueDate,
    respondedAt: order.respondedAt,
    restoredAt: order.restoredAt,
    completedAt: order.completedAt,
    escalatedAt: order.escalatedAt,
    contractorName: order.contractorName,
    sla: order.sla,
  };
}

function toEvent(
  row: typeof schema.workOrderEvent.$inferSelect,
  byName: string | null,
  documentTitle: string | null,
): WorkOrderEvent {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    at: row.at.toISOString(),
    byId: row.byId,
    byName: row.byId ? (byName ?? "") : SYSTEM_NAME_EL,
    kind: row.kind,
    noteEl: row.noteEl,
    documentId: row.documentId,
    documentTitle: row.documentId ? documentTitle : null,
  };
}

function orderWriteError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const code = sqlState(error);
  if (code === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
  // The one CHECK a valid body can still trip: a completed corrective order
  // whose codes somebody tried to clear (R34).
  if (code === CHECK_VIOLATION) throw AppError.unprocessable("errors.workOrderNeedsCodes");
  if (code === RESTRICT_VIOLATION) throw AppError.unprocessable("errors.workOrderNotValid");
  if (code === UNIQUE_VIOLATION) throw AppError.conflict("errors.workOrderNotValid");
  throw error;
}
