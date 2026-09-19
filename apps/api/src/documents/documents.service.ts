/**
 * Filing a document: the bytes to the store, the row to `document`, and the
 * queue row to `dms_outbox` — all three in one transaction.
 *
 * RULE (ADR-0023): the document row and the outbox row are written in the
 * same transaction. If the upload commits, the item is queued; if the queue
 * row cannot be written, the upload did not happen. There is no code path
 * here that records a document and hopes something else will remember to
 * send it, because «hopes something else will remember» is how an archive
 * ends up with a hole in it that nobody notices for a year.
 *
 * There is no permission check in this file and there is not meant to be one
 * (ADR-0010). A contract, project or variation in a unit the caller may not
 * see does not exist for them and the answer is 404; a write they may not
 * make is refused by the `document_write` policy.
 *
 * NO PATIENT DATA. The three item types are an award decision, a business
 * case and an approved variation.
 */
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { CONFIG, type AppConfig } from "../config";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { UNIQUE_VIOLATION, sqlState } from "../common/sql-error";
import { type DocumentRecord } from "./dms-contracts";
import {
  type ContractorFacts,
  type PersonAction,
  type UnitFacts,
  awardSourceRef,
  buildAwardMeta,
  buildBusinessCaseMeta,
  buildVariationMeta,
  businessCaseSourceRef,
  variationSourceRef,
} from "./dms-meta";
import { type DmsFile } from "./earchive-contract";
import { OBJECT_STORE, type ObjectStore } from "./object-store";

/** The multipart field name the MAIN file goes out under. */
const MAIN_PART = "file_main";

export interface UploadInput {
  bytes: Buffer;
  filename: string;
  mime: string;
  titleEl?: string;
}

/**
 * Greek labels for the roles, matching apps/web/src/i18n/el.json `roles.*`.
 * They travel to eArchive inside `approvals[].role`, where a clerk reads
 * them; a role name in English on a Greek protocol is a role nobody searches
 * for. Not i18n keys for the same reason the document type is not — see
 * ADR-0023.
 */
const ROLE_EL: Record<string, string> = {
  admin: "Διαχειριστής",
  estates_head: "Προϊστάμενος Τεχνικών Υπηρεσιών",
  project_engineer: "Μηχανικός έργου",
  technician: "Τεχνίτης",
  finance: "Οικονομική Διεύθυνση",
  clinical_approver: "Κλινικός εγκριτής",
  executive_readonly: "Διοίκηση",
  auditor_readonly: "Ελεγκτής",
};

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * R08, eArchive brief: the award decision on a contract.
   *
   * The contract is what the decision is about, so its award date is the
   * letter date and its value is the amount. The contractor becomes the
   * counterparty, keyed by SAP's vendor id (ADR-0021's own key), and the
   * project title goes in the subject because «Απόφαση κατακύρωσης
   * CAP-2026-0007» tells a clerk nothing about what was awarded.
   */
  async fileAwardDecision(contractId: string, upload: UploadInput): Promise<DocumentRecord> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(contractId)) throw AppError.notFound("errors.contractNotFound");

    const [row] = await tx.db
      .select({
        id: schema.contract.id,
        ref: schema.contract.ref,
        contractNo: schema.contract.contractNo,
        awardDate: schema.contract.awardDate,
        originalValue: schema.contract.originalValue,
        orgUnitId: schema.contract.orgUnitId,
        unitCode: schema.orgUnit.code,
        unitName: schema.orgUnit.nameEl,
        projectTitleEl: schema.project.titleEl,
        contractorId: schema.contractor.id,
        contractorName: schema.contractor.name,
        contractorVat: schema.contractor.vatNumber,
        contractorReg: schema.contractor.registrationNo,
        contractorSap: schema.contractor.sapVendorId,
      })
      .from(schema.contract)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.contract.orgUnitId))
      .innerJoin(schema.project, eq(schema.project.id, schema.contract.projectId))
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.contract.contractorId))
      .where(eq(schema.contract.id, contractId))
      .limit(1);
    if (!row) throw AppError.notFound("errors.contractNotFound");

    const version = await this.nextVersion("contract", contractId);
    const stored = await this.store.put({
      bytes: upload.bytes,
      filename: upload.filename,
      mime: upload.mime,
      prefix: `award/${contractId}`,
    });
    const files = [mainFile(stored)];
    const meta = buildAwardMeta(
      {
        contractId,
        ref: row.ref,
        contractNo: row.contractNo,
        awardDate: row.awardDate,
        originalValue: Number(row.originalValue),
        projectTitleEl: row.projectTitleEl,
        unit: unitOf(row.unitCode, row.unitName),
        contractor: contractorOf(row),
        approvals: await this.recordedBy("contract", contractId),
      },
      files,
      this.origin(),
      version,
    );

    return this.persist({
      orgUnitId: row.orgUnitId,
      entityType: "contract",
      entityId: contractId,
      kind: "AWARD_DECISION",
      titleEl: upload.titleEl?.trim() || meta.subject,
      sourceRef: awardSourceRef(contractId, version),
      sourceModule: "award",
      version,
      stored,
      meta,
      files,
    });
  }

  /**
   * The business case behind a project (CAPEX-01 §1's approval gate). Filed
   * under «Διοίκηση» and not «Συμβάσεις»: it is what the organisation decided
   * to do, before there is any contract.
   */
  async fileBusinessCase(projectId: string, upload: UploadInput): Promise<DocumentRecord> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(projectId)) throw AppError.notFound("errors.projectNotFound");

    const [row] = await tx.db
      .select({
        id: schema.project.id,
        code: schema.project.code,
        titleEl: schema.project.titleEl,
        approvedBudget: schema.project.approvedBudget,
        phaseChangedAt: schema.project.phaseChangedAt,
        orgUnitId: schema.project.orgUnitId,
        unitCode: schema.orgUnit.code,
        unitName: schema.orgUnit.nameEl,
      })
      .from(schema.project)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.project.orgUnitId))
      .where(eq(schema.project.id, projectId))
      .limit(1);
    if (!row) throw AppError.notFound("errors.projectNotFound");

    const version = await this.nextVersion("project", projectId);
    const stored = await this.store.put({
      bytes: upload.bytes,
      filename: upload.filename,
      mime: upload.mime,
      prefix: `business_case/${projectId}`,
    });
    const files = [mainFile(stored)];
    const meta = buildBusinessCaseMeta(
      {
        projectId,
        code: row.code,
        titleEl: row.titleEl,
        approvedBudget: Number(row.approvedBudget),
        letterDate: dateOnly(row.phaseChangedAt ?? new Date()),
        unit: unitOf(row.unitCode, row.unitName),
        approvals: await this.recordedBy("project", projectId),
      },
      files,
      this.origin(),
      version,
    );

    return this.persist({
      orgUnitId: row.orgUnitId,
      entityType: "project",
      entityId: projectId,
      kind: "BUSINESS_CASE",
      titleEl: upload.titleEl?.trim() || meta.subject,
      sourceRef: businessCaseSourceRef(row.code, version),
      sourceModule: "business_case",
      version,
      stored,
      meta,
      files,
    });
  }

  /**
   * RULE (eArchive brief, R10): an **approved** variation is what gets filed.
   * A draft, a submitted one and a rejected one are eCapital's own working
   * papers; the registry gets the decision. The approvals come off the
   * variation's own columns rather than the audit trail, because R10 keeps
   * the raiser and the decider there by name (ADR-0015).
   */
  async fileVariation(variationId: string, upload: UploadInput): Promise<DocumentRecord> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(variationId)) throw AppError.notFound("errors.variationNotFound");

    const [row] = await tx.db
      .select({
        id: schema.variation.id,
        number: schema.variation.number,
        descriptionEl: schema.variation.descriptionEl,
        value: schema.variation.value,
        status: schema.variation.status,
        raisedAt: schema.variation.raisedAt,
        decidedAt: schema.variation.decidedAt,
        decisionCommentEl: schema.variation.decisionCommentEl,
        raisedById: schema.variation.raisedBy,
        decidedById: schema.variation.decidedBy,
        orgUnitId: schema.variation.orgUnitId,
        contractId: schema.contract.id,
        contractRef: schema.contract.ref,
        unitCode: schema.orgUnit.code,
        unitName: schema.orgUnit.nameEl,
        contractorId: schema.contractor.id,
        contractorName: schema.contractor.name,
        contractorVat: schema.contractor.vatNumber,
        contractorReg: schema.contractor.registrationNo,
        contractorSap: schema.contractor.sapVendorId,
      })
      .from(schema.variation)
      .innerJoin(schema.contract, eq(schema.contract.id, schema.variation.contractId))
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.variation.orgUnitId))
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.contract.contractorId))
      .where(eq(schema.variation.id, variationId))
      .limit(1);
    if (!row) throw AppError.notFound("errors.variationNotFound");
    if (row.status !== "APPROVED") throw AppError.unprocessable("errors.variationNotApproved");

    const approvals = await this.variationApprovals(row);
    const version = await this.nextVersion("variation", variationId);
    const stored = await this.store.put({
      bytes: upload.bytes,
      filename: upload.filename,
      mime: upload.mime,
      prefix: `variation/${variationId}`,
    });
    const files = [mainFile(stored)];
    const meta = buildVariationMeta(
      {
        contractId: row.contractId,
        contractRef: row.contractRef,
        number: row.number,
        descriptionEl: row.descriptionEl,
        value: Number(row.value),
        letterDate: dateOnly(row.decidedAt ?? row.raisedAt),
        unit: unitOf(row.unitCode, row.unitName),
        contractor: contractorOf(row),
        approvals,
      },
      files,
      this.origin(),
      version,
    );

    return this.persist({
      orgUnitId: row.orgUnitId,
      entityType: "variation",
      entityId: variationId,
      kind: "VARIATION",
      titleEl: upload.titleEl?.trim() || meta.subject,
      sourceRef: variationSourceRef(row.contractRef, row.number, version),
      sourceModule: "variation",
      version,
      stored,
      meta,
      files,
    });
  }

  /** Everything the three routes already hold, listed for a screen. */
  async listFor(entityType: string, entityId: string): Promise<DocumentRecord[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(entityId)) return [];
    const rows = await tx.db
      .select({ doc: schema.document, status: schema.dmsOutbox.status })
      .from(schema.document)
      .leftJoin(schema.dmsOutbox, eq(schema.dmsOutbox.documentId, schema.document.id))
      .where(
        and(eq(schema.document.entityType, entityType), eq(schema.document.entityId, entityId)),
      )
      .orderBy(desc(schema.document.version));
    return rows.map((r) => toRecord(r.doc, r.status ?? null));
  }

  // ------------------------------------------------------------ internals --

  /**
   * The one transaction. `ecapital.dms_queue` writes the outbox row as the
   * owner — the queue is the service's and not a unit's — and it runs inside
   * the caller's transaction, so both rows commit together or neither does.
   */
  private async persist(input: {
    orgUnitId: string;
    entityType: string;
    entityId: string;
    kind: "AWARD_DECISION" | "BUSINESS_CASE" | "VARIATION";
    titleEl: string;
    sourceRef: string;
    sourceModule: string;
    version: number;
    stored: { objectKey: string; sha256: string; size: number; mime: string; filename: string };
    meta: unknown;
    files: DmsFile[];
  }): Promise<DocumentRecord> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const uploadedBy = await callerUserId();

    try {
      const [row] = await tx.db
        .insert(schema.document)
        .values({
          orgUnitId: input.orgUnitId,
          entityType: input.entityType,
          entityId: input.entityId,
          kind: input.kind,
          titleEl: input.titleEl.slice(0, 500),
          filename: input.stored.filename,
          mime: input.stored.mime,
          size: input.stored.size,
          sha256: input.stored.sha256,
          version: input.version,
          objectKey: input.stored.objectKey,
          sourceRef: input.sourceRef,
          uploadedBy,
        })
        .returning();
      if (!row) throw AppError.forbidden("errors.readOnlyAccount");

      const files = input.files.map((f) => ({ ...f, object_key: input.stored.objectKey }));
      await tx.db.execute(sql`
        select ecapital.dms_queue(
          ${input.sourceRef}::text,
          ${input.sourceModule}::text,
          ${row.id}::uuid,
          ${input.orgUnitId}::text,
          ${JSON.stringify(input.meta)}::jsonb,
          ${JSON.stringify(files)}::jsonb)`);

      return toRecord(row, "QUEUED");
    } catch (error) {
      if (error instanceof AppError) throw error;
      // The row policy answers an insert a caller may not make with zero
      // rows, not an error, so this is the other shape of refusal: the same
      // item filed twice under the same source_ref.
      if (sqlState(error) === UNIQUE_VIOLATION) {
        throw AppError.conflict("errors.documentAlreadyFiled");
      }
      throw error;
    }
  }

  /**
   * RULE (eArchive brief): a corrected document is a NEW item with a NEW
   * source_ref and a SUPERSEDES relation, never an edit of one that has
   * already been protocolled. The version is what makes the new reference
   * different, so filing the same award twice gives `award:<id>` and then
   * `award:<id>:v2`.
   */
  private async nextVersion(entityType: string, entityId: string): Promise<number> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({ version: schema.document.version })
      .from(schema.document)
      .where(
        and(eq(schema.document.entityType, entityType), eq(schema.document.entityId, entityId)),
      )
      .orderBy(desc(schema.document.version))
      .limit(1);
    return (row?.version ?? 0) + 1;
  }

  /**
   * «Approvals from the audit trail where available». For a contract and a
   * project there is no approver column, so who recorded it is what the
   * audit log says (R42, ADR-0011). An audit row the caller may not read
   * simply does not come back, and the item is filed with no approvals
   * rather than with somebody else's name on it.
   */
  private async recordedBy(entityType: string, entityId: string): Promise<PersonAction[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        at: schema.auditLog.at,
        name: schema.appUser.name,
        role: sql<string | null>`(
          select r.role::text from ecapital.app_user_role r
           where r.app_user_id = ${schema.appUser.id} order by r.role limit 1)`,
      })
      .from(schema.auditLog)
      .innerJoin(schema.appUser, eq(schema.appUser.subject, schema.auditLog.actorId))
      .where(
        and(
          eq(schema.auditLog.entityType, entityType),
          eq(schema.auditLog.entityId, entityId),
          eq(schema.auditLog.action, "INSERT"),
        ),
      )
      .limit(1);
    return rows.map((r) => ({
      name: r.name,
      role: roleLabel(r.role),
      action: "recorded" as const,
      at: r.at,
    }));
  }

  /** R10's two people, by name, off the variation's own columns. */
  private async variationApprovals(row: {
    raisedById: string;
    decidedById: string | null;
    raisedAt: Date;
    decidedAt: Date | null;
    decisionCommentEl: string | null;
  }): Promise<PersonAction[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const ids = [row.raisedById, row.decidedById].filter((id): id is string => Boolean(id));
    const people = await tx.db
      .select({
        id: schema.appUser.id,
        name: schema.appUser.name,
        role: sql<string | null>`(
          select r.role::text from ecapital.app_user_role r
           where r.app_user_id = ${schema.appUser.id} order by r.role limit 1)`,
      })
      .from(schema.appUser)
      .where(inArray(schema.appUser.id, ids));
    const byId = new Map(people.map((p) => [p.id, p]));

    const actions: PersonAction[] = [];
    const raiser = byId.get(row.raisedById);
    if (raiser) {
      actions.push({
        name: raiser.name,
        role: roleLabel(raiser.role),
        action: "submitted",
        at: row.raisedAt,
      });
    }
    const decider = row.decidedById ? byId.get(row.decidedById) : undefined;
    if (decider && row.decidedAt) {
      actions.push({
        name: decider.name,
        role: roleLabel(decider.role),
        action: "approved",
        at: row.decidedAt,
        comment: row.decisionCommentEl,
      });
    }
    return actions;
  }

  /**
   * `source_url` is a deep link into eCapital's own web app, which the API
   * knows only as the origin the browser is allowed to call it from. There is
   * no separate APP_ORIGIN variable and one is not added: CORS_ORIGINS
   * already names the web app, and a fourth place to write the same hostname
   * is a fourth place to get it wrong (ADR-0023).
   */
  private origin(): string {
    return this.config.corsOrigins[0] ?? "http://127.0.0.1:3000";
  }
}

function roleLabel(role: string | null): string {
  if (!role) return "Χρήστης";
  return ROLE_EL[role] ?? role;
}

function unitOf(code: string, nameEl: string): UnitFacts {
  return { code, nameEl };
}

function contractorOf(row: {
  contractorId: string;
  contractorName: string;
  contractorVat: string | null;
  contractorReg: string | null;
  contractorSap: string | null;
}): ContractorFacts {
  return {
    id: row.contractorId,
    name: row.contractorName,
    vatNumber: row.contractorVat,
    registrationNo: row.contractorReg,
    sapVendorId: row.contractorSap,
  };
}

function mainFile(stored: {
  filename: string;
  mime: string;
  size: number;
  sha256: string;
}): DmsFile {
  return {
    kind: "MAIN",
    part_name: MAIN_PART,
    filename: stored.filename.slice(0, 255),
    mime: stored.mime as DmsFile["mime"],
    size: stored.size,
    sha256: stored.sha256,
  };
}

function dateOnly(at: Date | string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  return date.toISOString().slice(0, 10);
}

export function toRecord(
  row: typeof schema.document.$inferSelect,
  outboxStatus: DocumentRecord["outboxStatus"],
): DocumentRecord {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    orgUnitId: row.orgUnitId,
    kind: row.kind,
    titleEl: row.titleEl,
    filename: row.filename,
    mime: row.mime,
    size: Number(row.size),
    sha256: row.sha256,
    version: row.version,
    sourceRef: row.sourceRef,
    protocolId: row.protocolId,
    protocolNumber: row.protocolNumber,
    legalHold: row.legalHold,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    outboxStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
