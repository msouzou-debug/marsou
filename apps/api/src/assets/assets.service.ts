/**
 * M4 — Πάγια, the asset register (R26–R30, R45).
 *
 * The asset, not the project, is the permanent record (CAPEX-01 §2, the
 * Kahua row): a project is an event in an asset's life, and the register
 * outlives it. So a project or a contract that goes away leaves the asset
 * standing, and `GET /assets/:id` assembles everything that ever touched it.
 *
 * OWNER STEER, 20/09/2026: lean. Identity, place, class, criticality,
 * condition, warranty, provenance, replacement, papers and a label. No
 * depreciation, no spares, no meter analytics (ADR-0028).
 *
 * There is no permission check in this file and there is not meant to be one
 * (ADR-0010). An asset in a unit the caller may not see does not exist for
 * them and the answer is 404; a write they may not make is refused by the
 * `asset_write` policy and comes back as 403. The one exception is the
 * condition, which goes through `ecapital.record_asset_condition` because a
 * row policy cannot be narrowed to a single column — the function carries
 * the same rule.
 *
 * NO PATIENT DATA. An asset is a machine in a room.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  Asset,
  AssetDetail,
  type AssetDocument,
  type AssetListQuery,
  type AssetListRow,
  type AssetReading,
  type AssetWrite,
  type Condition,
  type QrLabel,
  type ReplacementForecastRow,
} from "@ecapital/shared";
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { CONFIG, type AppConfig } from "../config";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { DocumentsService, type UploadInput } from "../documents/documents.service";
import type { AssetDocumentKindKey } from "../documents/dms-meta";
import {
  buildHistory,
  priorityRank,
  wholeLifeOf,
  type AuditFact,
  type HistoryParts,
} from "./asset-rows";

/** How far back the history reads. The same ceiling the permit trail uses. */
const HISTORY_LINES = 200;

type AssetRow = typeof schema.asset.$inferSelect;

export interface ConditionWrite {
  condition: Condition;
  assessedAt?: string | null;
  noteEl?: string | null;
}

export interface ReadingWrite {
  takenAt?: string;
  readingType: string;
  value: number;
  unit?: string | null;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly documents: DocumentsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------ the list --

  async list(query: AssetListQuery): Promise<{ items: AssetListRow[]; total: number }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const filters: SQL[] = [];
    if (query.orgUnitId) filters.push(eq(schema.asset.orgUnitId, query.orgUnitId));
    if (query.areaId) {
      if (!UUID.test(query.areaId)) return { items: [], total: 0 };
      filters.push(eq(schema.asset.areaId, query.areaId));
    }
    if (query.assetClass) filters.push(eq(schema.asset.assetClass, query.assetClass));
    if (query.criticality) filters.push(eq(schema.asset.criticality, query.criticality));
    if (query.condition) filters.push(eq(schema.asset.condition, query.condition));
    if (query.status) filters.push(eq(schema.asset.status, query.status));
    if (query.q?.trim()) {
      // Tag, name, serial and SAP asset number, case-insensitively. The tag
      // is what a technician types after reading a sticker, so it matches on
      // a fragment and not only from the start.
      const needle = `%${query.q.trim().toLowerCase()}%`;
      filters.push(
        sql`(lower(${schema.asset.tag}) like ${needle}
             or lower(${schema.asset.nameEl}) like ${needle}
             or lower(coalesce(${schema.asset.serialNo}, '')) like ${needle}
             or lower(coalesce(${schema.asset.sapAssetNo}, '')) like ${needle})`,
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    const [{ total }] = await tx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.asset)
      .where(where);

    const direction = query.dir === "asc" ? asc : desc;
    const order: SQL =
      query.sort === "condition"
        ? sql`${schema.asset.condition} ${sql.raw(query.dir)} nulls last`
        : query.sort === "replacementYear"
          ? sql`${schema.asset.replacementYear} ${sql.raw(query.dir)} nulls last`
          : direction(
              query.sort === "nameEl"
                ? schema.asset.nameEl
                : query.sort === "criticality"
                  ? schema.asset.criticality
                  : query.sort === "updatedAt"
                    ? schema.asset.updatedAt
                    : schema.asset.tag,
            );

    const rows = await tx.db
      .select({
        asset: schema.asset,
        areaNameEl: schema.area.nameEl,
        orgUnitNameEl: schema.orgUnit.nameEl,
      })
      .from(schema.asset)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.asset.orgUnitId))
      .leftJoin(schema.area, eq(schema.area.id, schema.asset.areaId))
      .where(where)
      // Second key so a page boundary is stable when the first key ties.
      .orderBy(order, asc(schema.asset.tag))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: rows.map((row) => toListRow(row.asset, row.areaNameEl, row.orgUnitNameEl)),
      total,
    };
  }

  // ----------------------------------------------------------- the write --

  /**
   * R26. The tag is allocated by the database and never by the caller
   * (ADR-0014's pattern): `AssetWrite` has no `tag`, and there is no endpoint
   * that changes one.
   */
  async create(input: AssetWrite): Promise<Asset> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    await this.checkUnit(input.orgUnitId);
    await this.checkPlaces(input.orgUnitId, input.areaId ?? null, input.servesAreaIds ?? []);
    await this.checkParent(input.orgUnitId, input.parentAssetId ?? null);
    await this.checkProvenance(
      input.orgUnitId,
      input.sourceProjectId ?? null,
      input.sourceContractId ?? null,
    );

    const allocated = await tx.db.execute(
      sql`select ecapital.allocate_asset_tag(${input.orgUnitId}::text, ${input.assetClass}::ecapital.asset_class) as tag`,
    );
    const tag = (allocated.rows as unknown as { tag: string }[])[0]?.tag;
    if (!tag) throw AppError.internal();

    try {
      const [row] = await tx.db
        .insert(schema.asset)
        .values({
          orgUnitId: input.orgUnitId,
          areaId: input.areaId ?? null,
          tag,
          nameEl: input.nameEl,
          assetClass: input.assetClass,
          manufacturer: input.manufacturer ?? null,
          model: input.model ?? null,
          serialNo: input.serialNo ?? null,
          installedDate: input.installedDate ?? null,
          commissionedDate: input.commissionedDate ?? null,
          sourceProjectId: input.sourceProjectId ?? null,
          sourceContractId: input.sourceContractId ?? null,
          capitalCost: money(input.capitalCost ?? null),
          warrantyEnd: input.warrantyEnd ?? null,
          expectedLifeYears: input.expectedLifeYears ?? null,
          replacementYear: input.replacementYear ?? null,
          replacementCostEst: money(input.replacementCostEst ?? null),
          criticality: input.criticality,
          condition: input.condition ?? null,
          // A band with no date is not an assessment. The CHECK says the same.
          conditionAssessedAt: input.condition
            ? new Date(input.conditionAssessedAt ?? new Date().toISOString())
            : null,
          parentAssetId: input.parentAssetId ?? null,
          servesAreaIds: input.servesAreaIds ?? [],
          system: input.system ?? null,
          costCentre: input.costCentre ?? null,
          sapAssetNo: input.sapAssetNo ?? null,
          status: input.status ?? "IN_SERVICE",
        })
        .returning();
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");
      return toAsset(row);
    } catch (error) {
      throw this.writeError(error);
    }
  }

  async update(id: string, patch: Partial<AssetWrite>): Promise<Asset> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.row(id);

    // The unit does not move. An asset that changed hospital would take its
    // tag, its papers and its history into a register that never bought it;
    // what really happens is a disposal here and a new asset there.
    if (patch.orgUnitId !== undefined && patch.orgUnitId !== existing.orgUnitId) {
      throw AppError.unprocessable("errors.assetUnitFixed");
    }
    if (patch.assetClass !== undefined && patch.assetClass !== existing.assetClass) {
      // The class is inside the tag, and the tag is on a sticker.
      throw AppError.unprocessable("errors.assetClassFixed");
    }
    await this.checkPlaces(
      existing.orgUnitId,
      patch.areaId === undefined ? existing.areaId : (patch.areaId ?? null),
      patch.servesAreaIds ?? existing.servesAreaIds,
    );
    if (patch.parentAssetId !== undefined) {
      await this.checkParent(existing.orgUnitId, patch.parentAssetId ?? null, id);
    }
    await this.checkProvenance(
      existing.orgUnitId,
      patch.sourceProjectId === undefined
        ? existing.sourceProjectId
        : (patch.sourceProjectId ?? null),
      patch.sourceContractId === undefined
        ? existing.sourceContractId
        : (patch.sourceContractId ?? null),
    );

    // Loosely typed on purpose: `updatedAt` takes the database's own clock
    // and not this process's, which drizzle's insert type does not describe.
    const values: Record<string, unknown> = { updatedAt: sql`now()` };
    if (patch.areaId !== undefined) values.areaId = patch.areaId ?? null;
    if (patch.nameEl !== undefined) values.nameEl = patch.nameEl;
    if (patch.manufacturer !== undefined) values.manufacturer = patch.manufacturer ?? null;
    if (patch.model !== undefined) values.model = patch.model ?? null;
    if (patch.serialNo !== undefined) values.serialNo = patch.serialNo ?? null;
    if (patch.installedDate !== undefined) values.installedDate = patch.installedDate ?? null;
    if (patch.commissionedDate !== undefined) {
      values.commissionedDate = patch.commissionedDate ?? null;
    }
    if (patch.sourceProjectId !== undefined) {
      values.sourceProjectId = patch.sourceProjectId ?? null;
    }
    if (patch.sourceContractId !== undefined) {
      values.sourceContractId = patch.sourceContractId ?? null;
    }
    if (patch.capitalCost !== undefined) values.capitalCost = money(patch.capitalCost ?? null);
    if (patch.warrantyEnd !== undefined) values.warrantyEnd = patch.warrantyEnd ?? null;
    if (patch.expectedLifeYears !== undefined) {
      values.expectedLifeYears = patch.expectedLifeYears ?? null;
    }
    if (patch.replacementYear !== undefined) values.replacementYear = patch.replacementYear ?? null;
    if (patch.replacementCostEst !== undefined) {
      values.replacementCostEst = money(patch.replacementCostEst ?? null);
    }
    if (patch.criticality !== undefined) values.criticality = patch.criticality;
    if (patch.condition !== undefined) {
      values.condition = patch.condition ?? null;
      values.conditionAssessedAt = patch.condition
        ? new Date(patch.conditionAssessedAt ?? new Date().toISOString())
        : null;
    }
    if (patch.parentAssetId !== undefined) values.parentAssetId = patch.parentAssetId ?? null;
    if (patch.servesAreaIds !== undefined) values.servesAreaIds = patch.servesAreaIds;
    if (patch.system !== undefined) values.system = patch.system ?? null;
    if (patch.costCentre !== undefined) values.costCentre = patch.costCentre ?? null;
    if (patch.sapAssetNo !== undefined) values.sapAssetNo = patch.sapAssetNo ?? null;
    if (patch.status !== undefined) values.status = patch.status;

    try {
      const touched = await tx.db
        .update(schema.asset)
        .set(values)
        .where(eq(schema.asset.id, id))
        .returning();
      // Nothing came back: the policy refused the write, which is a 403 and
      // not a 404 — the caller can see the row, they may not change it.
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return toAsset(touched[0]);
    } catch (error) {
      throw this.writeError(error);
    }
  }

  /**
   * CAPEX-01 §8: the condition is one of the five things the field records,
   * and the person in the plant room is the technician. The write goes
   * through `ecapital.record_asset_condition` because a row policy cannot be
   * narrowed to one column — the function carries the permission rule and
   * moves the band and its date and nothing else. The audit trigger fires as
   * usual and records the caller, which is what the history reads.
   *
   * `noteEl` is not stored. There is no note column on the register and the
   * owner steer says not to invent one; the sentence a technician types today
   * belongs on the work order M5 will bring. The field is accepted so the
   * mobile form can carry it now and not lose it later.
   */
  async recordCondition(id: string, input: ConditionWrite): Promise<Asset> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.row(id);
    try {
      // `select * from f(...)` and not `(f(...)).*`: the second form calls
      // the function once per column, which would write the condition
      // twenty-eight times and audit it twenty-eight times with it.
      const result = await tx.db.execute(
        sql`select * from ecapital.record_asset_condition(
              ${id}::uuid, ${input.condition}::text,
              ${input.assessedAt ?? null}::timestamptz)`,
      );
      const row = (result.rows as unknown as SnakeAssetRow[])[0];
      if (!row?.id) throw AppError.notFound("errors.assetNotFound");
      return toAsset(fromSnakeCase(row));
    } catch (error) {
      throw this.writeError(error);
    }
  }

  /** A plain reading. M5 builds on it; there is no analytics here. */
  async addReading(id: string, input: ReadingWrite): Promise<AssetReading> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.row(id);
    const takenBy = await callerUserId();
    try {
      const [row] = await tx.db
        .insert(schema.assetReading)
        .values({
          assetId: id,
          // Filled by the inherit trigger from the asset; a value is needed
          // for the insert to typecheck and is overwritten before it lands.
          orgUnitId: "",
          takenAt: input.takenAt ? new Date(input.takenAt) : new Date(),
          readingType: input.readingType.trim(),
          value: String(input.value),
          unit: input.unit?.trim() || null,
          takenBy,
        })
        .returning();
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");
      const [person] = await tx.db
        .select({ name: schema.appUser.name })
        .from(schema.appUser)
        .where(eq(schema.appUser.id, takenBy))
        .limit(1);
      return toReading(row, person?.name ?? "");
    } catch (error) {
      throw this.writeError(error);
    }
  }

  // ---------------------------------------------------------- the detail --

  async detail(id: string): Promise<AssetDetail> {
    const row = await this.row(id);
    return this.detailOf(row);
  }

  /**
   * R29, the scan route. `<APP_ORIGIN>/a/<tag>` is what the QR code carries,
   * so this is the first request a technician's telephone makes after the
   * camera opens the link — and the whole history is what it has to answer
   * with (the M4 definition of done).
   */
  async byTag(tag: string): Promise<AssetDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select()
      .from(schema.asset)
      .where(sql`upper(${schema.asset.tag}) = upper(${tag.trim()})`)
      .limit(1);
    // A tag in a unit the caller cannot read is invisible, not forbidden —
    // and so is one that was never issued. Both answer the same 404, in the
    // caller's language (R43).
    if (!rows.length) throw AppError.notFound("errors.assetTagNotFound", { tag: tag.trim() });
    return this.detailOf(rows[0]);
  }

  private async detailOf(row: AssetRow): Promise<AssetDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const [unitRow] = await tx.db
      .select({ nameEl: schema.orgUnit.nameEl })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, row.orgUnitId))
      .limit(1);

    // Null area_id is the common case — a chiller on the roof and a main LV
    // board belong to the building and not to a room (CAPEX-01 §4).
    const place = row.areaId
      ? (
          await tx.db
            .select({
              areaNameEl: schema.area.nameEl,
              floorCode: schema.floor.code,
              buildingCode: schema.building.code,
            })
            .from(schema.area)
            .innerJoin(schema.floor, eq(schema.floor.id, schema.area.floorId))
            .innerJoin(schema.building, eq(schema.building.id, schema.floor.buildingId))
            .where(eq(schema.area.id, row.areaId))
            .limit(1)
        )[0]
      : undefined;

    const project = row.sourceProjectId
      ? (
          await tx.db
            .select({
              id: schema.project.id,
              code: schema.project.code,
              titleEl: schema.project.titleEl,
              at: sql<string>`coalesce(${schema.project.actualStart}::timestamptz,
                                       ${schema.project.plannedStart}::timestamptz,
                                       ${schema.project.createdAt})`,
            })
            .from(schema.project)
            .where(eq(schema.project.id, row.sourceProjectId))
            .limit(1)
        )[0]
      : undefined;

    const contract = row.sourceContractId
      ? (
          await tx.db
            .select({
              id: schema.contract.id,
              ref: schema.contract.ref,
              titleEl: schema.contract.contractNo,
              at: sql<string>`coalesce(${schema.contract.awardDate}::timestamptz, ${schema.contract.createdAt})`,
            })
            .from(schema.contract)
            .where(eq(schema.contract.id, row.sourceContractId))
            .limit(1)
        )[0]
      : undefined;

    const parent = row.parentAssetId
      ? (
          await tx.db
            .select({ tag: schema.asset.tag })
            .from(schema.asset)
            .where(eq(schema.asset.id, row.parentAssetId))
            .limit(1)
        )[0]
      : undefined;

    const children = await tx.db
      .select({
        id: schema.asset.id,
        tag: schema.asset.tag,
        nameEl: schema.asset.nameEl,
        assetClass: schema.asset.assetClass,
      })
      .from(schema.asset)
      .where(eq(schema.asset.parentAssetId, row.id))
      .orderBy(asc(schema.asset.tag));

    const documentRows = await tx.db
      .select({ link: schema.assetDocument, doc: schema.document })
      .from(schema.assetDocument)
      .innerJoin(schema.document, eq(schema.document.id, schema.assetDocument.documentId))
      .where(eq(schema.assetDocument.assetId, row.id))
      .orderBy(desc(schema.document.createdAt));

    const readingRows = await tx.db
      .select({ reading: schema.assetReading, takenByName: schema.appUser.name })
      .from(schema.assetReading)
      .leftJoin(schema.appUser, eq(schema.appUser.id, schema.assetReading.takenBy))
      .where(eq(schema.assetReading.assetId, row.id))
      .orderBy(desc(schema.assetReading.takenAt));

    const permits = await this.permitsTouching(row);
    const openDefects = await this.openDefects(row.id);

    const audit = await tx.db
      .select({
        action: schema.auditLog.action,
        at: schema.auditLog.at,
        actorName: sql<
          string | null
        >`ecapital.user_display_name_by_subject(${schema.auditLog.actorId})`,
        beforeCondition: sql<string | null>`${schema.auditLog.before} ->> 'condition'`,
        afterCondition: sql<string | null>`${schema.auditLog.after} ->> 'condition'`,
      })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.entityType, "asset"), eq(schema.auditLog.entityId, row.id)),
      )
      .orderBy(desc(schema.auditLog.id))
      .limit(HISTORY_LINES);

    const parts: HistoryParts = {
      assetId: row.id,
      audit: audit.map(
        (a): AuditFact => ({
          action: a.action as AuditFact["action"],
          at: a.at.toISOString(),
          actorName: a.actorName,
          beforeCondition: a.beforeCondition,
          afterCondition: a.afterCondition,
        }),
      ),
      readings: readingRows.map((r) => ({
        at: r.reading.takenAt.toISOString(),
        readingType: r.reading.readingType,
        value: Number(r.reading.value),
        unit: r.reading.unit,
        takenByName: r.takenByName ?? "",
      })),
      documents: documentRows.map((d) => ({
        at: d.doc.createdAt.toISOString(),
        kind: d.link.kind,
        titleEl: d.doc.titleEl,
        protocolNumber: d.doc.protocolNumber,
      })),
      project: project
        ? {
            id: project.id,
            code: project.code,
            titleEl: project.titleEl,
            at: new Date(project.at).toISOString(),
          }
        : null,
      contract:
        contract && contract.ref
          ? {
              id: contract.id,
              ref: contract.ref,
              titleEl: contract.titleEl,
              at: new Date(contract.at).toISOString(),
            }
          : null,
      permits: permits.map((p) => ({
        id: p.id,
        ref: p.ref,
        titleEl: p.titleEl,
        status: p.status,
        at: p.plannedStart.toISOString(),
      })),
    };

    return AssetDetail.parse({
      ...toAsset(row),
      areaNameEl: place?.areaNameEl ?? null,
      buildingCode: place?.buildingCode ?? null,
      floorCode: place?.floorCode ?? null,
      orgUnitNameEl: unitRow?.nameEl ?? "",
      sourceProjectCode: project?.code ?? null,
      sourceContractRef: contract?.ref ?? null,
      parentTag: parent?.tag ?? null,
      children,
      documents: documentRows.map((d) => toAssetDocument(d.link, d.doc)),
      readings: readingRows.map((r) => toReading(r.reading, r.takenByName ?? "")),
      history: buildHistory(parts),
      wholeLife: wholeLifeOf(
        {
          capitalCost: numberOrNull(row.capitalCost),
          replacementCostEst: numberOrNull(row.replacementCostEst),
          replacementYear: row.replacementYear,
          expectedLifeYears: row.expectedLifeYears,
          installedDate: row.installedDate,
          commissionedDate: row.commissionedDate,
        },
        new Date(),
      ),
      // Not closed and not rejected: a permit that is still somebody's
      // business. A closed one is history and is in `history`.
      openPermits: permits
        .filter((p) => p.status !== "CLOSED" && p.status !== "REJECTED")
        .map((p) => ({ id: p.id, ref: p.ref, status: p.status })),
      openDefects,
    });
  }

  // ------------------------------------------------------------- papers --

  /**
   * R28. The `document` row, the `dms_outbox` item and the `asset_document`
   * link, in one transaction — the DMS service writes the first two exactly
   * as it does for an award decision, and this adds the third. Nothing about
   * eArchive is re-implemented here (ADR-0023, ADR-0028).
   */
  async addDocument(
    id: string,
    kind: AssetDocumentKindKey,
    upload: UploadInput,
  ): Promise<AssetDocument> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const row = await this.row(id);

    const [unit] = await tx.db
      .select({ code: schema.orgUnit.code, nameEl: schema.orgUnit.nameEl })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, row.orgUnitId))
      .limit(1);
    if (!unit) throw AppError.notFound("errors.unitNotFound");

    const record = await this.documents.fileAssetDocument(
      {
        id: row.id,
        tag: row.tag,
        nameEl: row.nameEl,
        orgUnitId: row.orgUnitId,
        unitCode: unit.code,
        unitName: unit.nameEl,
        capitalCost: numberOrNull(row.capitalCost),
        commissionedDate: row.commissionedDate,
        installedDate: row.installedDate,
      },
      kind,
      upload,
    );

    try {
      const [link] = await tx.db
        .insert(schema.assetDocument)
        .values({ assetId: row.id, documentId: record.id, orgUnitId: "", kind })
        .returning();
      if (!link) throw AppError.forbidden("errors.readOnlyAccount");
      return {
        id: link.id,
        assetId: row.id,
        kind,
        titleEl: record.titleEl,
        documentId: record.id,
        protocolNumber: record.protocolNumber,
        filedAt: null,
        mime: record.mime,
        size: record.size,
      };
    } catch (error) {
      throw this.writeError(error);
    }
  }

  // ------------------------------------------------------ labels, R29 --

  /**
   * The payload is a URL so that any phone camera opens the asset, and the
   * origin is read the way the eArchive `source_url` reads it: the first
   * `CORS_ORIGINS` entry, because that already names the web app and a fourth
   * place to write the same hostname is a fourth place to get it wrong
   * (ADR-0023).
   */
  async labels(ids: string[]): Promise<QrLabel[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const wanted = ids.filter((id) => UUID.test(id));
    if (!wanted.length) return [];

    const rows = await tx.db
      .select({
        id: schema.asset.id,
        tag: schema.asset.tag,
        nameEl: schema.asset.nameEl,
        areaNameEl: schema.area.nameEl,
      })
      .from(schema.asset)
      .leftJoin(schema.area, eq(schema.area.id, schema.asset.areaId))
      .where(inArray(schema.asset.id, wanted));

    const byId = new Map(rows.map((row) => [row.id, row]));
    const origin = this.origin();
    // In the order the caller asked for them: a sheet of labels is printed
    // and stuck on in that order, and one the printer reshuffled is a sheet
    // somebody has to sort by hand. An id the caller cannot see is dropped.
    return wanted.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      return [
        {
          assetId: row.id,
          tag: row.tag,
          nameEl: row.nameEl,
          areaNameEl: row.areaNameEl,
          url: `${origin.replace(/\/+$/, "")}/a/${row.tag}`,
        },
      ];
    });
  }

  // -------------------------------------------------- forecast, R30 --

  /**
   * Lean by the owner steer: a sum over `replacement_year` and
   * `replacement_cost_est`, by unit and year, with the count of the
   * life-critical ones beside it. No depreciation, no discounting, no curve —
   * this is what feeds the capital pipeline (CAPEX-01 §2 item 2) and nothing
   * more is built until a hospital asks for it (ADR-0028).
   *
   * A DISPOSED asset is left out: it has gone, and nobody is replacing it.
   */
  async replacementForecast(
    from: number,
    to: number,
    orgUnitId: string | null,
  ): Promise<ReplacementForecastRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const filters: SQL[] = [
      isNotNull(schema.asset.replacementYear),
      sql`${schema.asset.replacementYear} between ${from} and ${to}`,
      sql`${schema.asset.status} <> 'DISPOSED'`,
    ];
    if (orgUnitId) filters.push(eq(schema.asset.orgUnitId, orgUnitId));

    const rows = await tx.db
      .select({
        orgUnitId: schema.asset.orgUnitId,
        orgUnitNameEl: schema.orgUnit.nameEl,
        year: schema.asset.replacementYear,
        assets: sql<number>`count(*)::int`,
        estimatedCost: sql<string>`coalesce(sum(${schema.asset.replacementCostEst}), 0)`,
        criticalAssets: sql<number>`count(*) filter (where ${schema.asset.criticality} <= 2)::int`,
      })
      .from(schema.asset)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.asset.orgUnitId))
      .where(and(...filters))
      .groupBy(schema.asset.orgUnitId, schema.orgUnit.nameEl, schema.asset.replacementYear)
      .orderBy(asc(schema.orgUnit.nameEl), asc(schema.asset.replacementYear));

    return rows.map((row) => ({
      orgUnitId: row.orgUnitId,
      orgUnitNameEl: row.orgUnitNameEl,
      year: row.year as number,
      assets: row.assets,
      estimatedCost: Number(row.estimatedCost),
      criticalAssets: row.criticalAssets,
    }));
  }

  // ---------------------------------------------------------- internals --

  async row(id: string): Promise<AssetRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.assetNotFound");
    const rows = await tx.db
      .select()
      .from(schema.asset)
      .where(eq(schema.asset.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.assetNotFound");
    return rows[0];
  }

  /**
   * Every open permit that touches this asset: one that names its own room,
   * and one that names a room the asset serves (§6.1). Both matter to a
   * technician standing in front of it — a permit on the ICU the medical-gas
   * manifold feeds is a reason not to shut the manifold down.
   */
  private async permitsTouching(row: AssetRow): Promise<
    {
      id: string;
      ref: string | null;
      titleEl: string;
      status: string;
      plannedStart: Date;
    }[]
  > {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const areaIds = [...new Set([row.areaId, ...row.servesAreaIds].filter(Boolean))] as string[];
    if (!areaIds.length) return [];

    const rows = await tx.db
      .selectDistinct({
        id: schema.shutdownPermit.id,
        ref: schema.shutdownPermit.ref,
        titleEl: schema.shutdownPermit.titleEl,
        status: schema.shutdownPermit.status,
        plannedStart: schema.shutdownPermit.plannedStart,
      })
      .from(schema.shutdownPermit)
      .innerJoin(
        schema.shutdownPermitArea,
        eq(schema.shutdownPermitArea.permitId, schema.shutdownPermit.id),
      )
      .where(inArray(schema.shutdownPermitArea.areaId, areaIds))
      .orderBy(desc(schema.shutdownPermit.plannedStart));
    return rows;
  }

  /**
   * R12: open handover defects on this asset. Handover only, because that is
   * what the contract's `openDefects` counts — a defect the contractor still
   * owes. Inspection and work-order defects arrive with M5's backlog view.
   */
  private async openDefects(assetId: string): Promise<number> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.defect)
      .where(
        and(
          eq(schema.defect.assetId, assetId),
          eq(schema.defect.source, "HANDOVER"),
          sql`${schema.defect.status} <> 'CLOSED'`,
        ),
      );
    return row?.n ?? 0;
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

  /** Every room an asset names — where it stands and what it serves — is in its own unit. */
  private async checkPlaces(
    orgUnitId: string,
    areaId: string | null,
    servesAreaIds: string[],
  ): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const named = [...new Set([...(areaId ? [areaId] : []), ...servesAreaIds])];
    if (!named.length) return;
    if (named.some((id) => !UUID.test(id))) throw AppError.notFound("errors.assetAreaNotFound");

    const rows = await tx.db
      .select({ id: schema.area.id })
      .from(schema.area)
      .where(and(inArray(schema.area.id, named), eq(schema.area.orgUnitId, orgUnitId)));
    if (rows.length !== named.length) throw AppError.notFound("errors.assetAreaNotFound");
  }

  /** A parent is another asset of the same unit, and never the asset itself. */
  private async checkParent(
    orgUnitId: string,
    parentAssetId: string | null,
    selfId?: string,
  ): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!parentAssetId) return;
    if (!UUID.test(parentAssetId) || parentAssetId === selfId) {
      throw AppError.notFound("errors.assetParentNotFound");
    }
    const rows = await tx.db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(and(eq(schema.asset.id, parentAssetId), eq(schema.asset.orgUnitId, orgUnitId)))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.assetParentNotFound");
  }

  /** R27: the project and the contract an asset came out of belong to its unit. */
  private async checkProvenance(
    orgUnitId: string,
    projectId: string | null,
    contractId: string | null,
  ): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (projectId) {
      if (!UUID.test(projectId)) throw AppError.notFound("errors.projectNotFound");
      const rows = await tx.db
        .select({ id: schema.project.id })
        .from(schema.project)
        .where(and(eq(schema.project.id, projectId), eq(schema.project.orgUnitId, orgUnitId)))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.projectNotFound");
    }
    if (contractId) {
      if (!UUID.test(contractId)) throw AppError.notFound("errors.contractNotFound");
      const rows = await tx.db
        .select({ id: schema.contract.id })
        .from(schema.contract)
        .where(and(eq(schema.contract.id, contractId), eq(schema.contract.orgUnitId, orgUnitId)))
        .limit(1);
      if (!rows.length) throw AppError.notFound("errors.contractNotFound");
    }
  }

  private origin(): string {
    return this.config.corsOrigins[0] ?? "http://127.0.0.1:3000";
  }

  private writeError(error: unknown): never {
    if (error instanceof AppError) throw error;
    const code = sqlState(error);
    if (code === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
    if (code === RESTRICT_VIOLATION) throw AppError.unprocessable("errors.assetTagFixed");
    if (code === UNIQUE_VIOLATION) throw AppError.conflict("errors.assetDocumentAlreadyLinked");
    if (code === CHECK_VIOLATION) throw AppError.badRequest("errors.assetNotValid");
    throw error;
  }
}

// ------------------------------------------------------------ mapping --

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** numeric(14,2) goes in as a string so no precision is lost on the way. */
function money(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export function toAsset(row: AssetRow): Asset {
  return Asset.parse({
    id: row.id,
    orgUnitId: row.orgUnitId,
    areaId: row.areaId,
    tag: row.tag,
    nameEl: row.nameEl,
    assetClass: row.assetClass,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNo: row.serialNo,
    installedDate: row.installedDate,
    commissionedDate: row.commissionedDate,
    sourceProjectId: row.sourceProjectId,
    sourceContractId: row.sourceContractId,
    capitalCost: numberOrNull(row.capitalCost),
    warrantyEnd: row.warrantyEnd,
    expectedLifeYears: row.expectedLifeYears,
    replacementYear: row.replacementYear,
    replacementCostEst: numberOrNull(row.replacementCostEst),
    criticality: row.criticality,
    condition: row.condition,
    conditionAssessedAt: row.conditionAssessedAt ? row.conditionAssessedAt.toISOString() : null,
    parentAssetId: row.parentAssetId,
    servesAreaIds: row.servesAreaIds,
    system: row.system,
    costCentre: row.costCentre,
    sapAssetNo: row.sapAssetNo,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toListRow(
  row: AssetRow,
  areaNameEl: string | null,
  orgUnitNameEl: string,
): AssetListRow {
  return {
    id: row.id,
    tag: row.tag,
    nameEl: row.nameEl,
    assetClass: row.assetClass,
    criticality: row.criticality,
    condition: row.condition as Condition | null,
    status: row.status,
    replacementYear: row.replacementYear,
    warrantyEnd: row.warrantyEnd,
    orgUnitId: row.orgUnitId,
    areaId: row.areaId,
    areaNameEl,
    orgUnitNameEl,
    priorityRank: priorityRank(row.criticality, row.condition as Condition | null, row.status),
  };
}

function toReading(
  row: typeof schema.assetReading.$inferSelect,
  takenByName: string,
): AssetReading {
  return {
    id: row.id,
    assetId: row.assetId,
    takenAt: row.takenAt.toISOString(),
    readingType: row.readingType,
    value: Number(row.value),
    unit: row.unit,
    takenByName,
  };
}

function toAssetDocument(
  link: typeof schema.assetDocument.$inferSelect,
  doc: typeof schema.document.$inferSelect,
): AssetDocument {
  return {
    id: link.id,
    assetId: link.assetId,
    kind: link.kind,
    titleEl: doc.titleEl,
    documentId: doc.id,
    protocolNumber: doc.protocolNumber,
    // eArchive's answer is what «filed» means. There is no separate column:
    // a protocol number and the moment it arrived are the same fact, and the
    // document row's updated_at is when eCapital heard (ADR-0023).
    filedAt: doc.protocolNumber ? doc.updatedAt.toISOString() : null,
    mime: doc.mime,
    size: Number(doc.size),
  };
}

/**
 * `select * from ecapital.record_asset_condition(...)` comes back as raw
 * Postgres column names, because it is a composite type and not a drizzle
 * query. Mapped once here rather than parsed twice.
 */
interface SnakeAssetRow {
  id: string;
  org_unit_id: string;
  area_id: string | null;
  tag: string;
  name_el: string;
  asset_class: AssetRow["assetClass"];
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  installed_date: string | null;
  commissioned_date: string | null;
  source_project_id: string | null;
  source_contract_id: string | null;
  capital_cost: string | null;
  warranty_end: string | null;
  expected_life_years: number | null;
  replacement_year: number | null;
  replacement_cost_est: string | null;
  criticality: number;
  condition: string | null;
  condition_assessed_at: Date | null;
  parent_asset_id: string | null;
  serves_area_ids: string[];
  system: AssetRow["system"];
  cost_centre: string | null;
  sap_asset_no: string | null;
  status: AssetRow["status"];
  created_at: Date;
  updated_at: Date;
}

function fromSnakeCase(row: SnakeAssetRow): AssetRow {
  return {
    id: row.id,
    orgUnitId: row.org_unit_id,
    areaId: row.area_id,
    tag: row.tag,
    nameEl: row.name_el,
    assetClass: row.asset_class,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNo: row.serial_no,
    installedDate: row.installed_date,
    commissionedDate: row.commissioned_date,
    sourceProjectId: row.source_project_id,
    sourceContractId: row.source_contract_id,
    capitalCost: row.capital_cost,
    warrantyEnd: row.warranty_end,
    expectedLifeYears: row.expected_life_years,
    replacementYear: row.replacement_year,
    replacementCostEst: row.replacement_cost_est,
    criticality: row.criticality,
    condition: row.condition,
    conditionAssessedAt: row.condition_assessed_at,
    parentAssetId: row.parent_asset_id,
    servesAreaIds: row.serves_area_ids,
    system: row.system,
    costCentre: row.cost_centre,
    sapAssetNo: row.sap_asset_no,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
