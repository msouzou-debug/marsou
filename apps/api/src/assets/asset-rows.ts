/**
 * The parts of M4 that are arithmetic and Greek rather than SQL: the
 * priority rank every list has to agree on, the lean whole-life view, and
 * the assembly of the asset's history.
 *
 * Pure functions, no database and no HTTP, because these are the three
 * things a reader of ADR-0028 will want to check: 1 is the most urgent,
 * remaining life never goes below zero, and the history is newest first with
 * one line per thing that ever touched the asset.
 *
 * NO PATIENT DATA. Every sentence built here names a machine, a room, a
 * project, a contract or a permit.
 */
import type {
  AssetHistoryEntry,
  Condition,
  AssetDetail,
  AssetStatus,
} from "@ecapital/shared";

/**
 * RULE (S21, contract): «the rank is server-side so every list agrees».
 *
 * It is therefore a function of the two fields and not a position in the
 * page — the same chiller ranks the same whether it is read through
 * `GET /assets`, through a unit filter or through the forecast. Criticality
 * first (1 = life-critical), then physical condition worst-first, so a
 * life-expired life-critical asset is 1 and a cosmetic as-new one is 29.
 *
 * An unknown condition sorts **after** the five known bands of its
 * criticality: it is missing information, and the honest thing is to put it
 * behind what is known rather than to guess a band for it.
 *
 * A DISPOSED asset has no rank at all. It has left the estate, and a piece
 * of dead plant at the top of a worklist is how a worklist stops being read.
 */
const CONDITION_ORDER: Record<Condition, number> = { E: 0, D: 1, C: 2, B: 3, A: 4 };
const UNKNOWN_CONDITION = 5;
const CONDITION_BANDS = 6;

export function priorityRank(
  criticality: number,
  condition: Condition | null,
  status: AssetStatus,
): number | null {
  if (status === "DISPOSED") return null;
  const band = condition === null ? UNKNOWN_CONDITION : CONDITION_ORDER[condition];
  const step = Math.min(Math.max(criticality, 1), 5) - 1;
  return step * CONDITION_BANDS + band + 1;
}

// ----------------------------------------------------------- whole life --

export interface WholeLifeFacts {
  capitalCost: number | null;
  replacementCostEst: number | null;
  replacementYear: number | null;
  expectedLifeYears: number | null;
  installedDate: string | null;
  commissionedDate: string | null;
}

const MS_PER_YEAR = 365.2425 * 24 * 3_600_000;

/**
 * R30, lean (owner steer, 20/09/2026). Four numbers off the row, an age and
 * what is left of the expected life. There is no depreciation model here and
 * there is not meant to be one; `maintenanceToDate` is null until M5 has
 * work orders to add up, and saying null is better than saying zero, which
 * would read as «nothing has been spent».
 *
 * The age runs from the day it went into service — the commissioning date
 * where there is one, the installation date otherwise. Remaining life never
 * goes below zero: an asset eight years past its expected life has none
 * left, not minus eight.
 */
export function wholeLifeOf(facts: WholeLifeFacts, now: Date): AssetDetail["wholeLife"] {
  const from = facts.commissionedDate ?? facts.installedDate;
  const started = from ? Date.parse(`${from}T00:00:00Z`) : Number.NaN;
  const ageYears = Number.isNaN(started)
    ? null
    : Math.max(0, Math.round(((now.getTime() - started) / MS_PER_YEAR) * 10) / 10);

  const remainingLifeYears =
    ageYears === null || facts.expectedLifeYears === null
      ? null
      : Math.max(0, Math.round((facts.expectedLifeYears - ageYears) * 10) / 10);

  return {
    capitalCost: facts.capitalCost,
    // M5. Null and not zero: nothing has been counted, which is not the same
    // as nothing having been spent.
    maintenanceToDate: null,
    replacementCostEst: facts.replacementCostEst,
    replacementYear: facts.replacementYear,
    ageYears,
    remainingLifeYears,
  };
}

// -------------------------------------------------------------- history --

/**
 * M4's definition of done: «a technician scans a QR label and sees the full
 * history». Everything that ever touched the asset, newest first.
 *
 * WORK_ORDER and DEFECT are on the contract's list of kinds and are not
 * produced here: M5 builds the work orders, and a defect only becomes an
 * asset's once somebody records one against it. The assembler returns what
 * exists rather than an empty list with a promise attached.
 */
export interface AuditFact {
  action: "INSERT" | "UPDATE" | "DELETE";
  at: string;
  actorName: string | null;
  beforeCondition: string | null;
  afterCondition: string | null;
}

export interface ReadingFact {
  at: string;
  readingType: string;
  value: number;
  unit: string | null;
  takenByName: string;
}

export interface DocumentFact {
  at: string;
  kind: string;
  titleEl: string;
  protocolNumber: string | null;
}

export interface ProjectFact {
  id: string;
  code: string;
  titleEl: string;
  at: string;
}

export interface ContractFact {
  id: string;
  ref: string;
  titleEl: string;
  at: string;
}

export interface PermitFact {
  id: string;
  ref: string | null;
  titleEl: string;
  status: string;
  at: string;
}

export interface HistoryParts {
  assetId: string;
  audit: AuditFact[];
  readings: ReadingFact[];
  documents: DocumentFact[];
  project: ProjectFact | null;
  contract: ContractFact | null;
  permits: PermitFact[];
}

/** «Φυσική κατάσταση» is the glossary's term for the condition (CAPEX-02 §7). */
const DOCUMENT_KIND_EL: Record<string, string> = {
  OM_MANUAL: "Εγχειρίδιο λειτουργίας και συντήρησης",
  CERT: "Πιστοποιητικό",
  COMMISSIONING: "Φάκελος παραλαβής",
  WARRANTY: "Εγγύηση",
  DRAWING: "Σχέδιο",
  PHOTO: "Φωτογραφία",
};

const PERMIT_STATUS_EL: Record<string, string> = {
  DRAFT: "προσχέδιο",
  SUBMITTED: "υποβλήθηκε",
  CLINICAL_REVIEW: "σε κλινικό έλεγχο",
  APPROVED: "εγκρίθηκε",
  ACTIVE: "σε ισχύ",
  BREACH: "σε υπέρβαση",
  CLOSED: "έκλεισε",
  REJECTED: "απορρίφθηκε",
};

export function buildHistory(parts: HistoryParts): AssetHistoryEntry[] {
  const href = `/assets/${parts.assetId}`;
  const entries: AssetHistoryEntry[] = [];

  for (const row of parts.audit) {
    if (row.action === "INSERT") {
      entries.push({
        at: row.at,
        kind: "CREATED",
        actorName: row.actorName,
        summaryEl: "Το πάγιο καταχωρίστηκε στο μητρώο",
        href,
      });
      continue;
    }
    if (row.action !== "UPDATE") continue;
    // A change of band is the one update that gets its own kind: it is the
    // technician's assessment and the thing the replacement argument rests on.
    if (row.afterCondition !== row.beforeCondition && row.afterCondition !== null) {
      entries.push({
        at: row.at,
        kind: "CONDITION",
        actorName: row.actorName,
        summaryEl: row.beforeCondition
          ? `Φυσική κατάσταση: από ${row.beforeCondition} σε ${row.afterCondition}`
          : `Φυσική κατάσταση: ${row.afterCondition}`,
        href,
      });
      continue;
    }
    entries.push({
      at: row.at,
      kind: "UPDATED",
      actorName: row.actorName,
      summaryEl: "Τα στοιχεία του παγίου ενημερώθηκαν",
      href,
    });
  }

  for (const reading of parts.readings) {
    const unit = reading.unit ? ` ${reading.unit}` : "";
    entries.push({
      at: reading.at,
      kind: "READING",
      actorName: reading.takenByName,
      summaryEl: `Μέτρηση ${reading.readingType}: ${formatNumber(reading.value)}${unit}`,
      href,
    });
  }

  for (const document of parts.documents) {
    const kind = DOCUMENT_KIND_EL[document.kind] ?? document.kind;
    const protocol = document.protocolNumber
      ? `, αρ. πρωτοκόλλου ${document.protocolNumber}`
      : ", σε αναμονή πρωτοκόλλου";
    entries.push({
      at: document.at,
      kind: "DOCUMENT",
      actorName: null,
      summaryEl: `${kind}: ${document.titleEl}${protocol}`,
      href,
    });
  }

  if (parts.project) {
    entries.push({
      at: parts.project.at,
      kind: "PROJECT",
      actorName: null,
      summaryEl: `Προήλθε από το έργο ${parts.project.code} — ${parts.project.titleEl}`,
      href: `/projects/${parts.project.id}`,
    });
  }

  if (parts.contract) {
    entries.push({
      at: parts.contract.at,
      kind: "CONTRACT",
      actorName: null,
      summaryEl: `Παραδόθηκε με τη σύμβαση ${parts.contract.ref} — ${parts.contract.titleEl}`,
      href: `/contracts/${parts.contract.id}`,
    });
  }

  for (const permit of parts.permits) {
    const status = PERMIT_STATUS_EL[permit.status] ?? permit.status;
    entries.push({
      at: permit.at,
      kind: "PERMIT",
      actorName: null,
      summaryEl: `Άδεια διακοπής ${permit.ref ?? "χωρίς αριθμό"} — ${permit.titleEl} (${status})`,
      href: `/permits/${permit.id}`,
    });
  }

  // Newest first. The kind breaks a tie so the order is stable when two
  // things carry the same timestamp — a seeded register does, and a page
  // that reshuffles itself between two reads is a page nobody trusts.
  return entries.sort((a, b) =>
    a.at === b.at ? a.kind.localeCompare(b.kind) : a.at < b.at ? 1 : -1,
  );
}

/** Greek decimals, and no trailing «,0» on a whole number of run hours. */
function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100).replace(".", ",");
}
