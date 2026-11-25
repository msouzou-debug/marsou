/**
 * ADR-0035 — loading what `computeDelay` needs, for one contract (the
 * contract screen) or for many (the exceptions report, the contractor
 * scorecard). Runs inside the caller's transaction, so the row policies decide
 * which contracts, sections, extensions and claims exist for them (ADR-0010).
 * A claim's papers (0029) come with it: `document` rows on the claim, read
 * through the same transaction, so `document_read` decides which come back.
 */
import type {
  ClaimDocument,
  ContractClaim,
  ContractDelay,
  ContractExtension,
  ContractSection,
  ProjectPhase,
} from "@ecapital/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { phaseIndex } from "../projects/project-rows";
import { computeDelay } from "./delay";
import { money } from "./contract-rows";

/** What a contract's delay figures are built from, and the rows the screen shows. */
export interface ContractDelayRecords {
  sections: ContractSection[];
  extensions: ContractExtension[];
  claims: ContractClaim[];
  delay: ContractDelay;
}

const STOPPED_FROM: ProjectPhase = "PRACTICAL_COMPLETION";

/**
 * The delay records of every contract named, keyed by contract id. A contract
 * the caller may not see is simply absent from the map.
 *
 * RULE (ADR-0035): a contract has no handover column of its own, so its own
 * clock (a contract without sections) stops at the project's actual finish.
 * A project already at practical completion or later with no actual finish
 * recorded stops at the day it last changed phase, which is the latest date
 * the works can have been handed over; otherwise the clock runs to `asOf`.
 */
export async function loadContractDelays(
  contractIds: string[],
  asOf: string,
): Promise<Map<string, ContractDelayRecords>> {
  const out = new Map<string, ContractDelayRecords>();
  if (!contractIds.length) return out;
  const tx = currentTx();
  if (!tx) throw AppError.internal();

  const [contracts, sections, extensions, claims, papers] = await Promise.all([
    tx.db
      .select({
        id: schema.contract.id,
        completionDate: schema.contract.completionDate,
        rate: schema.contract.liquidatedDamagesPerDay,
        ldActivatedAt: schema.contract.ldActivatedAt,
        phase: schema.project.phase,
        actualFinish: schema.project.actualFinish,
        phaseChangedOn: sql<string | null>`(${schema.project.phaseChangedAt} at time zone 'Europe/Nicosia')::date::text`,
      })
      .from(schema.contract)
      .innerJoin(schema.project, sql`${schema.project.id} = ${schema.contract.projectId}`)
      .where(inArray(schema.contract.id, contractIds)),
    tx.db
      .select()
      .from(schema.contractSection)
      .where(inArray(schema.contractSection.contractId, contractIds))
      .orderBy(asc(schema.contractSection.sortOrder), asc(schema.contractSection.code)),
    tx.db
      .select({
        row: schema.contractExtension,
        createdByName: sql<string | null>`ecapital.user_display_name(${schema.contractExtension.createdBy})`,
      })
      .from(schema.contractExtension)
      .where(inArray(schema.contractExtension.contractId, contractIds))
      .orderBy(desc(schema.contractExtension.approvedAt), desc(schema.contractExtension.createdAt)),
    tx.db
      .select()
      .from(schema.contractClaim)
      .where(inArray(schema.contractClaim.contractId, contractIds))
      .orderBy(desc(schema.contractClaim.createdAt)),
    // A tombstone (eArchive deleted the protocol) is not a paper to open, so
    // it is not listed; the row stays in `document` as the record of it.
    tx.db
      .select()
      .from(schema.document)
      .where(
        and(
          eq(schema.document.entityType, CLAIM_ENTITY),
          isNull(schema.document.deletedAt),
          inArray(
            schema.document.entityId,
            tx.db
              .select({ id: schema.contractClaim.id })
              .from(schema.contractClaim)
              .where(inArray(schema.contractClaim.contractId, contractIds)),
          ),
        ),
      )
      .orderBy(asc(schema.document.createdAt), asc(schema.document.version)),
  ]);

  const papersByClaim = new Map<string, ClaimDocument[]>();
  for (const row of papers) {
    const paper = toClaimDocument(row);
    if (!paper) continue;
    papersByClaim.set(row.entityId, [...(papersByClaim.get(row.entityId) ?? []), paper]);
  }

  for (const contract of contracts) {
    const mine = {
      sections: sections.filter((s) => s.contractId === contract.id).map(toSection),
      extensions: extensions
        .filter((e) => e.row.contractId === contract.id)
        .map((e) => toExtension(e.row, e.createdByName)),
      claims: claims
        .filter((c) => c.contractId === contract.id)
        .map((c) => toClaim(c, papersByClaim.get(c.id) ?? [])),
    };
    const stopped = phaseIndex(contract.phase) >= phaseIndex(STOPPED_FROM);
    const delay = computeDelay({
      contract: {
        completionDate: contract.completionDate,
        liquidatedDamagesPerDay: contract.rate === null ? null : money(contract.rate),
        ldActivatedAt: contract.ldActivatedAt,
        handoverDate: contract.actualFinish ?? (stopped ? contract.phaseChangedOn : null),
      },
      sections: mine.sections,
      extensions: mine.extensions,
      claims: mine.claims,
      asOf,
    });
    out.set(contract.id, { ...mine, delay });
  }
  return out;
}

export function toSection(row: typeof schema.contractSection.$inferSelect): ContractSection {
  return {
    id: row.id,
    contractId: row.contractId,
    code: row.code,
    titleEl: row.titleEl,
    completionDate: row.completionDate,
    handoverDate: row.handoverDate,
    liquidatedDamagesPerDay:
      row.liquidatedDamagesPerDay === null ? null : money(row.liquidatedDamagesPerDay),
    ldActivatedAt: row.ldActivatedAt,
    ldActivationNoteEl: row.ldActivationNoteEl,
    sortOrder: row.sortOrder,
  };
}

export function toExtension(
  row: typeof schema.contractExtension.$inferSelect,
  createdByName: string | null,
): ContractExtension {
  return {
    id: row.id,
    contractId: row.contractId,
    sectionId: row.sectionId,
    days: row.days,
    approvedAt: row.approvedAt,
    approver: row.approver,
    approverNameEl: row.approverNameEl,
    reasonEl: row.reasonEl,
    contractorCulpable: row.contractorCulpable,
    documentId: row.documentId,
    createdAt: row.createdAt.toISOString(),
    createdByName: createdByName ?? null,
  };
}

/** `document.entity_type` for a claim's papers (0029). */
export const CLAIM_ENTITY = "contract_claim";

const CLAIM_KINDS = new Set<string>(["CLAIM_LETTER", "CLAIM_REPLY", "CLAIM_LEGAL_LETTER"]);

/** A `document` row as a claim's paper; null for any other kind, which a claim does not carry. */
export function toClaimDocument(row: typeof schema.document.$inferSelect): ClaimDocument | null {
  if (!CLAIM_KINDS.has(row.kind)) return null;
  return {
    documentId: row.id,
    kind: row.kind as ClaimDocument["kind"],
    titleEl: row.titleEl,
    filename: row.filename,
    mime: row.mime,
    size: Number(row.size),
    protocolNumber: row.protocolNumber,
    filedAt: row.createdAt.toISOString(),
  };
}

export function toClaim(
  row: typeof schema.contractClaim.$inferSelect,
  documents: ClaimDocument[] = [],
): ContractClaim {
  return {
    id: row.id,
    contractId: row.contractId,
    direction: row.direction,
    titleEl: row.titleEl,
    amount: money(row.amount),
    stage: row.stage,
    notifiedAt: row.notifiedAt,
    legalAdvisorEl: row.legalAdvisorEl,
    contingentLiability: row.contingentLiability,
    notesEl: row.notesEl,
    documentId: row.documentId,
    documents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
