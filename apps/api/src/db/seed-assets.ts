/**
 * The M4 half of the seed: the asset register (R26–R30, R45, CAPEX-01 §15).
 *
 * Run as the migration role, which owns the tables and is therefore not
 * filtered by row-level security — a seed that could only see its own units
 * would be useless.
 *
 * Re-running updates in place and never duplicates: an asset is found again
 * by its unit and its Greek name, which the fixture keeps unique for exactly
 * that reason, and an asset that is already there **keeps the tag it was
 * given**. The tag is on a sticker on a machine; a seed that reissued it
 * would be a seed that relabelled the estate.
 *
 * The readings are relative to the moment the seed runs, because «last week»
 * is a fact about the clock. Everything else is fixed, so the register looks
 * the same on every machine.
 *
 * NO PATIENT DATA. Machines, rooms, dates and money.
 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assetDocumentSourceRef, buildAssetDocumentMeta } from "../documents/dms-meta";
import * as schema from "./schema";
import { type SeedAsset, seedAssets } from "./seed-data";

type Db = NodePgDatabase<typeof schema>;

export interface AssetSeedSummary {
  assets: number;
  assetReadings: number;
  assetDocuments: number;
}

const DAY_MS = 86_400_000;

/**
 * The origin the seeded documents' deep links carry. The running API reads
 * it from CORS_ORIGINS (ADR-0023); the seed has no request and no config, so
 * it uses the development default — a seeded protocol's source_url is a
 * development fact, like every other figure in the seed.
 */
const SEED_ORIGIN = "http://127.0.0.1:3000";

export async function seedAssetRegister(db: Db): Promise<AssetSeedSummary> {
  const summary: AssetSeedSummary = { assets: 0, assetReadings: 0, assetDocuments: 0 };
  const now = Date.now();

  const units = await db
    .select({ id: schema.orgUnit.id, code: schema.orgUnit.code, nameEl: schema.orgUnit.nameEl })
    .from(schema.orgUnit);
  const unitById = new Map(units.map((u) => [u.id, u]));

  // Areas by unit and code — the fixture names a room by its code, because
  // the seed does not know the uuids until it has written them.
  const areas = await db
    .select({ id: schema.area.id, code: schema.area.code, orgUnitId: schema.area.orgUnitId })
    .from(schema.area);
  const areaByUnitCode = new Map(areas.map((a) => [`${a.orgUnitId}:${a.code}`, a.id]));

  const [technician] = await db
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(eq(schema.appUser.subject, "dev-technician-nicosia"))
    .limit(1);
  const [admin] = await db
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(eq(schema.appUser.subject, "dev-admin"))
    .limit(1);
  const readingAuthor = technician?.id ?? admin?.id;

  const idByKey = new Map<string, string>();

  for (const fixture of seedAssets) {
    const unit = unitById.get(fixture.orgUnitId);
    if (!unit) continue;

    const areaId = fixture.areaCode
      ? (areaByUnitCode.get(`${fixture.orgUnitId}:${fixture.areaCode}`) ?? null)
      : null;
    const servesAreaIds = fixture.servesAreaCodes
      .map((code) => areaByUnitCode.get(`${fixture.orgUnitId}:${code}`))
      .filter((id): id is string => Boolean(id));

    const provenance = await findProvenance(db, fixture);

    const values = {
      orgUnitId: fixture.orgUnitId,
      areaId,
      nameEl: fixture.nameEl,
      assetClass: fixture.assetClass,
      manufacturer: fixture.manufacturer,
      model: fixture.model,
      serialNo: fixture.serialNo,
      installedDate: fixture.installedDate,
      commissionedDate: fixture.commissionedDate,
      sourceProjectId: provenance.projectId,
      sourceContractId: provenance.contractId,
      capitalCost: fixture.capitalCost === null ? null : fixture.capitalCost.toFixed(2),
      warrantyEnd: fixture.warrantyEnd,
      expectedLifeYears: fixture.expectedLifeYears,
      replacementYear: fixture.replacementYear,
      replacementCostEst:
        fixture.replacementCostEst === null ? null : fixture.replacementCostEst.toFixed(2),
      criticality: fixture.criticality,
      condition: fixture.condition,
      // The CHECK says a band and a date come together or not at all. The
      // assessment is dated at commissioning where there is one, because that
      // is when somebody last looked at it on paper.
      conditionAssessedAt: fixture.condition
        ? new Date(`${fixture.commissionedDate ?? fixture.installedDate ?? "2026-01-05"}T09:00:00Z`)
        : null,
      parentAssetId: fixture.parentKey ? (idByKey.get(fixture.parentKey) ?? null) : null,
      servesAreaIds,
      system: fixture.system,
      costCentre: fixture.costCentre,
      sapAssetNo: fixture.sapAssetNo,
      status: fixture.status,
    };

    const [existing] = await db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(
        and(
          eq(schema.asset.orgUnitId, fixture.orgUnitId),
          eq(schema.asset.nameEl, fixture.nameEl),
        ),
      )
      .limit(1);

    let assetId: string;
    if (existing) {
      // The tag is not in the update. It was issued once and is on a label.
      const [row] = await db
        .update(schema.asset)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.asset.id, existing.id))
        .returning({ id: schema.asset.id });
      assetId = row.id;
    } else {
      const [row] = await db
        .insert(schema.asset)
        .values({
          ...values,
          tag: sql`ecapital.allocate_asset_tag(${fixture.orgUnitId}::text, ${fixture.assetClass}::ecapital.asset_class)`,
        })
        .returning({ id: schema.asset.id });
      assetId = row.id;
    }
    idByKey.set(fixture.key, assetId);
    summary.assets += 1;

    // ------------------------------------------------------- the readings --
    if (readingAuthor) {
      for (const reading of fixture.readings) {
        const takenAt = new Date(now - reading.daysAgo * DAY_MS);
        const [seen] = await db
          .select({ id: schema.assetReading.id })
          .from(schema.assetReading)
          .where(
            and(
              eq(schema.assetReading.assetId, assetId),
              eq(schema.assetReading.readingType, reading.readingType),
              eq(schema.assetReading.value, reading.value.toFixed(4)),
            ),
          )
          .limit(1);
        if (seen) {
          await db
            .update(schema.assetReading)
            .set({ takenAt, unit: reading.unit, updatedAt: sql`now()` })
            .where(eq(schema.assetReading.id, seen.id));
        } else {
          await db.insert(schema.assetReading).values({
            assetId,
            orgUnitId: fixture.orgUnitId,
            takenAt,
            readingType: reading.readingType,
            value: reading.value.toFixed(4),
            unit: reading.unit,
            takenBy: readingAuthor,
          });
        }
        summary.assetReadings += 1;
      }
    }

    // ------------------------------------------------------- the papers --
    // R28: filed with eArchive and carrying the protocol number it came back
    // with. Seeded as SENT — these are papers from years ago, and a register
    // whose commissioning pack was «queued» would be telling a lie about the
    // registry (ADR-0023).
    let n = 0;
    for (const paper of fixture.documents) {
      n += 1;
      const sourceRef = assetDocumentSourceRef(assetId, n);
      const bytes = Buffer.from(paper.body, "utf8");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const objectKey = `asset/${assetId}/${sha256.slice(0, 16)}-${paper.filename}`;
      const files = [
        {
          kind: "MAIN" as const,
          part_name: "file_main",
          filename: paper.filename,
          mime: paper.mime as "application/pdf",
          size: bytes.byteLength,
          sha256,
        },
      ];
      const meta = buildAssetDocumentMeta(
        {
          assetId,
          tag: (
            await db
              .select({ tag: schema.asset.tag })
              .from(schema.asset)
              .where(eq(schema.asset.id, assetId))
              .limit(1)
          )[0].tag,
          nameEl: fixture.nameEl,
          kind: paper.kind,
          n,
          letterDate: fixture.commissionedDate ?? fixture.installedDate ?? "2026-01-05",
          capitalCost: fixture.capitalCost,
          unit: { code: unit.code, nameEl: unit.nameEl },
          approvals: [],
        },
        files,
        SEED_ORIGIN,
      );

      const [seenDoc] = await db
        .select({ id: schema.document.id })
        .from(schema.document)
        .where(eq(schema.document.sourceRef, sourceRef))
        .limit(1);

      let documentId: string;
      if (seenDoc) {
        documentId = seenDoc.id;
        await db
          .update(schema.document)
          .set({
            titleEl: paper.titleEl,
            protocolId: `seed-${sha256.slice(0, 12)}`,
            protocolNumber: paper.protocolNumber,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.document.id, documentId));
      } else {
        const [row] = await db
          .insert(schema.document)
          .values({
            orgUnitId: fixture.orgUnitId,
            entityType: "asset",
            entityId: assetId,
            kind: "ASSET_DOCUMENT",
            titleEl: paper.titleEl,
            filename: paper.filename,
            mime: paper.mime,
            size: bytes.byteLength,
            sha256,
            version: n,
            objectKey,
            sourceRef,
            protocolId: `seed-${sha256.slice(0, 12)}`,
            protocolNumber: paper.protocolNumber,
            uploadedBy: admin?.id ?? null,
          })
          .returning({ id: schema.document.id });
        documentId = row.id;
      }

      // The queue row, in the state it would be in after eArchive answered.
      const [seenOutbox] = await db
        .select({ id: schema.dmsOutbox.id })
        .from(schema.dmsOutbox)
        .where(eq(schema.dmsOutbox.sourceRef, sourceRef))
        .limit(1);
      if (!seenOutbox) {
        await db.insert(schema.dmsOutbox).values({
          sourceRef,
          sourceModule: "asset_document",
          documentId,
          orgUnitId: fixture.orgUnitId,
          meta,
          files,
          status: "SENT",
          protocolId: `seed-${sha256.slice(0, 12)}`,
          protocolNumber: paper.protocolNumber,
          sentAt: new Date(`${fixture.commissionedDate ?? "2026-01-05"}T10:00:00Z`),
        });
      }

      await db
        .insert(schema.assetDocument)
        .values({ assetId, documentId, orgUnitId: fixture.orgUnitId, kind: paper.kind })
        .onConflictDoNothing();
      summary.assetDocuments += 1;
    }
  }

  return summary;
}

/**
 * R27: the project the asset came out of, and the contract it was delivered
 * under. Both are found through the seeded project's Greek title within its
 * own unit — the same way the site log finds its contracts.
 */
async function findProvenance(
  db: Db,
  fixture: SeedAsset,
): Promise<{ projectId: string | null; contractId: string | null }> {
  if (!fixture.projectTitleEl) return { projectId: null, contractId: null };

  const [project] = await db
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(
      and(
        eq(schema.project.orgUnitId, fixture.orgUnitId),
        eq(schema.project.titleEl, fixture.projectTitleEl),
      ),
    )
    .limit(1);
  if (!project) return { projectId: null, contractId: null };
  if (!fixture.withContract) return { projectId: project.id, contractId: null };

  const [contract] = await db
    .select({ id: schema.contract.id })
    .from(schema.contract)
    .where(eq(schema.contract.projectId, project.id))
    .limit(1);
  return { projectId: project.id, contractId: contract?.id ?? null };
}
