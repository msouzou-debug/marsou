/**
 * M5 — Εκκρεμότητες συντήρησης, the maintenance backlog (R35, R36;
 * ADR-0031 §7–8).
 *
 * Work the agreement will not absorb: a repair the budget has no line for, a
 * replacement, an upgrade, a statutory gap. Banded with the defect's four
 * NHS ERIC bands and costed; the unfunded sum by unit and band is next
 * year's capital programme input. «Σε έργο» drafts a project at the Idea
 * phase from an item and funds the item, in one transaction.
 *
 * No permission check here (ADR-0010): `can_manage_backlog` decides who
 * writes, `can_manage_project` who may draft the project, and the R36
 * auto-draft has its own narrow insert policy because the technician who
 * completes the order is usually who triggers it.
 */
import { Injectable } from "@nestjs/common";
import type {
  BacklogCreate,
  BacklogItem,
  BacklogListQuery,
  BacklogPatch,
  BacklogSummaryRow,
  BacklogToProject,
  RiskBand,
} from "@ecapital/shared";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { INSUFFICIENT_PRIVILEGE, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { writeError } from "./contracts.service";
import { backlogColumns, money, toBacklogItem } from "./maintenance-rows";

export type BacklogQuery = BacklogListQuery & { page: number; pageSize: number };

/** Worst first: HIGH is 4. The list sorts on this, never on the enum's own order. */
const BAND_RANK = sql`(case ${schema.backlogItem.riskBand}
  when 'HIGH' then 4 when 'SIGNIFICANT' then 3 when 'MODERATE' then 2 else 1 end)`;

type ProjectCategory = (typeof schema.projectCategory.enumValues)[number];

@Injectable()
export class BacklogService {
  // ------------------------------------------------------------ the list --

  async list(query: BacklogQuery): Promise<{ items: BacklogItem[]; total: number }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const b = schema.backlogItem;
    const filters: SQL[] = [];
    if (query.orgUnitId) filters.push(eq(b.orgUnitId, query.orgUnitId));
    if (query.riskBand) filters.push(eq(b.riskBand, query.riskBand));
    if (query.status?.length) filters.push(inArray(b.status, query.status));
    if (query.kind) filters.push(eq(b.kind, query.kind));
    if (query.assetId) {
      if (!UUID.test(query.assetId)) return { items: [], total: 0 };
      filters.push(eq(b.assetId, query.assetId));
    }
    if (query.autoDrafted !== undefined) filters.push(eq(b.autoDrafted, query.autoDrafted));
    if (query.q?.trim()) {
      const needle = sql`'%' || ecapital.normalise(${query.q.trim()}) || '%'`;
      filters.push(
        sql`(ecapital.normalise(${b.titleEl}) like ${needle}
             or ecapital.normalise(coalesce(${b.descriptionEl}, '')) like ${needle}
             or ecapital.normalise(coalesce(${schema.asset.tag}, '')) like ${needle})`,
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    const [{ total }] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(b)
      .leftJoin(schema.asset, eq(schema.asset.id, b.assetId))
      .where(where);

    const dir = query.dir === "asc" ? "asc" : "desc";
    const order: SQL =
      query.sort === "costEstimate"
        ? sql`${b.costEstimate} ${sql.raw(dir)} nulls last`
        : query.sort === "raisedAt"
          ? sql`${b.raisedAt} ${sql.raw(dir)}`
          : query.sort === "status"
            ? sql`${b.status} ${sql.raw(dir)}`
            : sql`${BAND_RANK} ${sql.raw(dir)}`;

    const rows = await this.selectItems()
      .where(where)
      .orderBy(order, sql`${b.raisedAt} desc`, asc(b.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { items: rows.map(toBacklogItem), total };
  }

  /** Every item the export carries, worst band first, with its unit's name. */
  async exportRows(orgUnitId: string | null): Promise<{ unitName: string; item: BacklogItem }[]> {
    const b = schema.backlogItem;
    const rows = await this.selectItems()
      .where(orgUnitId ? eq(b.orgUnitId, orgUnitId) : undefined)
      .orderBy(asc(schema.orgUnit.nameEl), sql`${BAND_RANK} desc`, asc(b.titleEl));
    return rows.map((row) => ({ unitName: row.unitName, item: toBacklogItem(row) }));
  }

  /**
   * S21's totals over OPEN and FUNDED — what is still somebody's to pay
   * for. DONE and DROPPED are history.
   */
  async summary(orgUnitId: string | null): Promise<BacklogSummaryRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const b = schema.backlogItem;
    const filters: SQL[] = [inArray(b.status, ["OPEN", "FUNDED"])];
    if (orgUnitId) filters.push(eq(b.orgUnitId, orgUnitId));
    const rows = await tx.db
      .select({
        orgUnitId: b.orgUnitId,
        unitName: schema.orgUnit.nameEl,
        riskBand: b.riskBand,
        count: sql<number>`count(*)::int`,
        costEstimate: sql<string>`coalesce(sum(${b.costEstimate}), 0)`,
        fundedCost: sql<string>`coalesce(sum(${b.costEstimate}) filter (where ${b.status} = 'FUNDED'), 0)`,
        unfundedCost: sql<string>`coalesce(sum(${b.costEstimate}) filter (where ${b.status} = 'OPEN'), 0)`,
      })
      .from(b)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, b.orgUnitId))
      .where(and(...filters))
      .groupBy(b.orgUnitId, schema.orgUnit.nameEl, b.riskBand)
      .orderBy(asc(schema.orgUnit.nameEl), sql`max(${BAND_RANK}) desc`);
    return rows.map((row) => ({
      orgUnitId: row.orgUnitId,
      unitName: row.unitName,
      riskBand: row.riskBand as RiskBand,
      count: row.count,
      costEstimate: Number(row.costEstimate),
      fundedCost: Number(row.fundedCost),
      unfundedCost: Number(row.unfundedCost),
    }));
  }

  // ----------------------------------------------------------- the write --

  async create(input: BacklogCreate): Promise<BacklogItem> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const unit = await this.resolveUnit(input);
    await this.checkLinks(unit, input.assetId ?? null, input.slaSystemId ?? null);
    if (input.sourceWorkOrderId) await this.checkOrder(unit, input.sourceWorkOrderId);
    const raisedBy = await callerUserId();
    try {
      const [row] = await tx.db
        .insert(schema.backlogItem)
        .values({
          orgUnitId: unit,
          kind: input.kind,
          titleEl: input.titleEl.trim(),
          descriptionEl: input.descriptionEl ?? null,
          riskBand: input.riskBand,
          costEstimate: money(input.costEstimate ?? null),
          assetId: input.assetId ?? null,
          slaSystemId: input.slaSystemId ?? null,
          sourceWorkOrderId: input.sourceWorkOrderId ?? null,
          autoDrafted: false,
          status: "OPEN",
          raisedBy,
        })
        .returning({ id: schema.backlogItem.id });
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");
      return await this.detail(row.id);
    } catch (error) {
      throw writeError(error, "errors.backlogItemNotValid", "errors.backlogItemNotValid");
    }
  }

  /**
   * RULE (R35): FUNDED means a capital project is paying, so it carries the
   * project. DONE and DROPPED stamp when the item left the backlog; going
   * back to OPEN or FUNDED clears the stamp.
   */
  async update(id: string, patch: BacklogPatch): Promise<BacklogItem> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);

    const status = patch.status ?? existing.status;
    const project =
      patch.targetProjectId !== undefined ? patch.targetProjectId : existing.targetProjectId;
    if (status === "FUNDED" && !project) {
      throw AppError.unprocessable("errors.backlogFundedNeedsProject");
    }
    if (patch.targetProjectId) await this.checkProject(existing.orgUnitId, patch.targetProjectId);

    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.titleEl !== undefined) values.titleEl = patch.titleEl.trim();
    if (patch.descriptionEl !== undefined) values.descriptionEl = patch.descriptionEl ?? null;
    if (patch.riskBand !== undefined) values.riskBand = patch.riskBand;
    if (patch.costEstimate !== undefined) values.costEstimate = money(patch.costEstimate ?? null);
    if (patch.targetProjectId !== undefined) values.targetProjectId = patch.targetProjectId ?? null;
    if (patch.status !== undefined && patch.status !== existing.status) {
      values.status = patch.status;
      values.closedAt =
        patch.status === "DONE" || patch.status === "DROPPED" ? sql`now()` : null;
    }
    try {
      const touched = await tx.db
        .update(schema.backlogItem)
        .set(values)
        .where(eq(schema.backlogItem.id, id))
        .returning({ id: schema.backlogItem.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return await this.detail(id);
    } catch (error) {
      throw writeError(error, "errors.backlogItemNotValid", "errors.backlogFundedNeedsProject");
    }
  }

  /**
   * «Σε έργο» (ADR-0031 §7): a project at IDEA in the item's unit — the
   * item's title, its cost as the approved budget, its history as the note —
   * and the item FUNDED against it. One transaction, the request's: if the
   * item cannot be funded the project is not drafted either.
   */
  async toProject(
    id: string,
    input: BacklogToProject,
  ): Promise<{ projectId: string; projectCode: string; item: BacklogItem }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const item = await this.row(id);
    if (item.status !== "OPEN") throw AppError.conflict("errors.backlogNotOpen");

    const category = await this.categoryFor(item.assetId, item.slaSystemId, item.kind);
    const year = new Date().getUTCFullYear();
    try {
      const [{ code }] = await tx.db
        .select({ code: sql<string>`ecapital.allocate_project_code(${item.orgUnitId}, ${year})` })
        .from(sql`(select 1) as one`);
      const [project] = await tx.db
        .insert(schema.project)
        .values({
          code,
          orgUnitId: item.orgUnitId,
          titleEl: (input.titleEl ?? item.titleEl).trim(),
          noteEl: item.historyEl ?? item.descriptionEl ?? null,
          category,
          phase: "IDEA",
          // ASSUMPTION (ADR-0031 §7): the item's estimate is the opening
          // budget, zero when it has none; the funding source is the state
          // budget until the business case says otherwise.
          approvedBudget: item.costEstimate ?? "0",
          fundingSource: "STATE_BUDGET",
          rag: "GREEN",
          ragReason: "",
        })
        .returning({ id: schema.project.id, code: schema.project.code });
      if (!project) throw AppError.forbidden("errors.readOnlyAccount");

      const touched = await tx.db
        .update(schema.backlogItem)
        .set({ status: "FUNDED", targetProjectId: project.id, closedAt: null, updatedAt: sql`now()` })
        .where(eq(schema.backlogItem.id, id))
        .returning({ id: schema.backlogItem.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return { projectId: project.id, projectCode: project.code, item: await this.detail(id) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  // ---------------------------------------------------------- internals --

  async detail(id: string): Promise<BacklogItem> {
    if (!UUID.test(id)) throw AppError.notFound("errors.backlogItemNotFound");
    const [row] = await this.selectItems().where(eq(schema.backlogItem.id, id)).limit(1);
    if (!row) throw AppError.notFound("errors.backlogItemNotFound");
    return toBacklogItem(row);
  }

  private selectItems() {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const b = schema.backlogItem;
    return tx.db
      .select(backlogColumns)
      .from(b)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, b.orgUnitId))
      .leftJoin(schema.asset, eq(schema.asset.id, b.assetId))
      .leftJoin(schema.slaSystem, eq(schema.slaSystem.id, b.slaSystemId))
      .leftJoin(schema.workOrder, eq(schema.workOrder.id, b.sourceWorkOrderId))
      .leftJoin(schema.project, eq(schema.project.id, b.targetProjectId));
  }

  private async row(id: string) {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.backlogItemNotFound");
    const [row] = await tx.db
      .select()
      .from(schema.backlogItem)
      .where(eq(schema.backlogItem.id, id))
      .limit(1);
    if (!row) throw AppError.notFound("errors.backlogItemNotFound");
    return row;
  }

  /** The unit is the asset's when there is one, else the body's; never two different ones. */
  private async resolveUnit(input: BacklogCreate): Promise<string> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    let unit = input.orgUnitId ?? null;
    if (input.assetId) {
      if (!UUID.test(input.assetId)) throw AppError.notFound("errors.assetNotFound");
      const [asset] = await tx.db
        .select({ orgUnitId: schema.asset.orgUnitId })
        .from(schema.asset)
        .where(eq(schema.asset.id, input.assetId))
        .limit(1);
      if (!asset) throw AppError.notFound("errors.assetNotFound");
      if (unit && unit !== asset.orgUnitId) throw AppError.badRequest("errors.workOrderUnitMismatch");
      unit = asset.orgUnitId;
    }
    if (!unit) throw AppError.badRequest("errors.workOrderNeedsUnit");
    const [found] = await tx.db
      .select({ id: schema.orgUnit.id })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, unit))
      .limit(1);
    if (!found) throw AppError.notFound("errors.unitNotFound");
    return unit;
  }

  private async checkLinks(unit: string, assetId: string | null, systemId: string | null) {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (systemId) {
      if (!UUID.test(systemId)) throw AppError.notFound("errors.slaSystemNotFound");
      const [system] = await tx.db
        .select({ orgUnitId: schema.slaSystem.orgUnitId })
        .from(schema.slaSystem)
        .where(eq(schema.slaSystem.id, systemId))
        .limit(1);
      if (!system) throw AppError.notFound("errors.slaSystemNotFound");
      if (system.orgUnitId !== unit) throw AppError.badRequest("errors.workOrderUnitMismatch");
    }
    if (assetId && !UUID.test(assetId)) throw AppError.notFound("errors.assetNotFound");
  }

  private async checkOrder(unit: string, orderId: string) {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(orderId)) throw AppError.notFound("errors.workOrderNotFound");
    const [order] = await tx.db
      .select({ orgUnitId: schema.workOrder.orgUnitId })
      .from(schema.workOrder)
      .where(eq(schema.workOrder.id, orderId))
      .limit(1);
    if (!order) throw AppError.notFound("errors.workOrderNotFound");
    if (order.orgUnitId !== unit) throw AppError.badRequest("errors.workOrderUnitMismatch");
  }

  private async checkProject(unit: string, projectId: string) {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(projectId)) throw AppError.notFound("errors.projectNotFound");
    const [project] = await tx.db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(and(eq(schema.project.id, projectId), eq(schema.project.orgUnitId, unit)))
      .limit(1);
    if (!project) throw AppError.notFound("errors.projectNotFound");
  }

  /**
   * The project category from what the item is about. A machine of the
   * estate's plant is MAINTENANCE_CAPITAL; medical equipment is EQUIPMENT;
   * IT is IT; the building's fabric is RENOVATION. The project register has
   * no OTHER, so anything unmapped is MAINTENANCE_CAPITAL — which is what a
   * backlog item is.
   */
  private async categoryFor(
    assetId: string | null,
    systemId: string | null,
    kind: string,
  ): Promise<ProjectCategory> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    let assetClass: string | null = null;
    if (assetId) {
      const [asset] = await tx.db
        .select({ assetClass: schema.asset.assetClass })
        .from(schema.asset)
        .where(eq(schema.asset.id, assetId))
        .limit(1);
      assetClass = asset?.assetClass ?? null;
    }
    if (!assetClass && systemId) {
      const [system] = await tx.db
        .select({ assetClass: schema.slaSystem.assetClass })
        .from(schema.slaSystem)
        .where(eq(schema.slaSystem.id, systemId))
        .limit(1);
      assetClass = system?.assetClass ?? null;
    }
    if (assetClass === "BIOMEDICAL") return "EQUIPMENT";
    if (assetClass === "IT") return "IT";
    if (assetClass === "BUILDING_FABRIC") return "RENOVATION";
    // An upgrade with nothing to say what it upgrades is still capital work
    // on the estate.
    return kind === "UPGRADE" ? "CAPITAL_WORKS" : "MAINTENANCE_CAPITAL";
  }
}
