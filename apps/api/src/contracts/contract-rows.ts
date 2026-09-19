/**
 * Turning contract rows into the shapes packages/shared publishes, and the
 * rules that are pure functions of a row: the commitment arithmetic and the
 * three warn-and-flag rules of R31.
 *
 * Kept out of the service so the rules can be unit-tested without a database,
 * and so the portfolio can run the same three rules over its own query
 * instead of a second implementation of them.
 */
import {
  type BoqItem,
  type Contract,
  type ContractWarning,
  type ProjectPhase,
} from "@ecapital/shared";
import { phaseIndex } from "../projects/project-rows";

/** numeric arrives from pg as a string so no precision is lost in transit. */
export function money(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number(value);
}

export interface ContractRow {
  id: string;
  projectId: string;
  orgUnitId: string;
  contractorId: string;
  contractorName: string;
  contractNo: string;
  type: Contract["type"];
  awardDate: string;
  awardDecisionDocId: string | null;
  originalValue: string | number;
  currentValue: string | number;
  currency: string;
  startDate: string | null;
  completionDate: string | null;
  extensionDays: number;
  retentionPct: string | number;
  performanceBondValue: string | number | null;
  bondExpiry: string | null;
  liquidatedDamagesPerDay: string | number | null;
  defectsLiabilityMonths: number;
  sapPoNumber: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function toContract(row: ContractRow): Contract {
  return {
    id: row.id,
    projectId: row.projectId,
    orgUnitId: row.orgUnitId,
    contractorId: row.contractorId,
    contractorName: row.contractorName,
    contractNo: row.contractNo,
    type: row.type,
    awardDate: row.awardDate,
    awardDecisionDocId: row.awardDecisionDocId,
    originalValue: money(row.originalValue),
    // RULE (CAPEX-01 §7): derived in the database — original value plus the
    // approved variations — and never typed.
    currentValue: money(row.currentValue),
    currency: "EUR",
    startDate: row.startDate,
    completionDate: row.completionDate,
    extensionDays: row.extensionDays,
    retentionPct: money(row.retentionPct),
    performanceBondValue:
      row.performanceBondValue === null ? null : money(row.performanceBondValue),
    bondExpiry: row.bondExpiry,
    liquidatedDamagesPerDay:
      row.liquidatedDamagesPerDay === null ? null : money(row.liquidatedDamagesPerDay),
    defectsLiabilityMonths: row.defectsLiabilityMonths,
    sapPoNumber: row.sapPoNumber,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export interface BoqRow {
  id: string;
  contractId: string;
  itemNo: string;
  descriptionEl: string;
  unit: string;
  qty: string | number;
  rate: string | number;
  amount: string | number | null;
}

export function toBoqItem(row: BoqRow): BoqItem {
  return {
    id: row.id,
    contractId: row.contractId,
    itemNo: row.itemNo,
    descriptionEl: row.descriptionEl,
    unit: row.unit,
    qty: money(row.qty),
    rate: money(row.rate),
    // Generated in the database as qty × rate; nobody types it.
    amount: money(row.amount),
    };
}

// ----------------------------------------------------------- warn and flag --

/**
 * RULE (R31, CAPEX-01 §7): the warnings fire and nothing stops. A variation
 * that takes the cumulative approved total past a tenth of the original
 * contract is the rule the brief names; an expired performance bond and a
 * completion date that has gone past are the two other facts a contract
 * already knows without waiting for SAP.
 *
 * None of them blocks a write, and none of them is a state on the contract.
 * They are computed on the way out, so a contract that is put right stops
 * warning the moment it is put right.
 */
export const VARIATION_LIMIT_PCT = 10;

export interface WarningInput {
  contractNo: string;
  projectTitleEl: string;
  originalValue: number;
  approvedVariationsTotal: number;
  bondExpiry: string | null;
  completionDate: string | null;
  extensionDays: number;
  projectPhase: ProjectPhase;
  /**
   * R09: how many site instructions on this contract carry cost impact and
   * have not been turned into a variation yet. Work the contractor is doing
   * that the commitment does not know about.
   */
  instructionsWithoutVariation: number;
}

/** One fired rule, before anybody has decided which language to say it in. */
export interface WarningFact {
  key: ContractWarning["key"];
  amount: number | null;
  /** Everything the sentence needs except the unit name and the money format. */
  facts: {
    contract: string;
    project: string;
    pct?: number;
    date?: string;
    days?: number;
    count?: number;
  };
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** How far past practical completion a project has to be for the third rule to go quiet. */
const COMPLETED_FROM: ProjectPhase = "PRACTICAL_COMPLETION";

export function warningFacts(input: WarningInput, today: string): WarningFact[] {
  const facts: WarningFact[] = [];
  const named = { contract: input.contractNo, project: input.projectTitleEl };

  // 1. Cumulative approved variations above a tenth of the original value.
  //    The amount is the excess, which is the figure the head of estates has
  //    to explain, not the total.
  if (input.originalValue > 0) {
    const limit = (input.originalValue * VARIATION_LIMIT_PCT) / 100;
    if (input.approvedVariationsTotal > limit) {
      facts.push({
        key: "variationsOverTenPct",
        amount: round2(input.approvedVariationsTotal - limit),
        facts: {
          ...named,
          pct: round1((input.approvedVariationsTotal / input.originalValue) * 100),
        },
      });
    }
  }

  // 2. A performance bond that expired while the contract is still running.
  if (input.bondExpiry !== null && input.bondExpiry < today) {
    facts.push({ key: "bondExpired", amount: null, facts: { ...named, date: input.bondExpiry } });
  }

  // 3. A completion date, extensions included, that has gone past while the
  //    project is still short of practical completion. Past that phase the
  //    works are done and the date is history, so the rule goes quiet.
  if (
    input.completionDate !== null &&
    phaseIndex(input.projectPhase) < phaseIndex(COMPLETED_FROM)
  ) {
    const due = addDays(input.completionDate, input.extensionDays);
    if (due < today) {
      facts.push({
        key: "completionPast",
        amount: null,
        facts: { ...named, date: due, days: daysBetween(due, today) },
      });
    }
  }

  // 4. Site instructions with cost impact that nobody has priced (R09).
  //    CAPEX-01 §4: an instruction that costs money has to end up as a
  //    variation, because otherwise the works grow and the commitment does
  //    not. Warn and flag, like the other three: the instruction stands, the
  //    contractor keeps working, and somebody has to go and price it.
  if (input.instructionsWithoutVariation > 0) {
    facts.push({
      key: "instructionsWithoutVariation",
      amount: null,
      facts: { ...named, count: input.instructionsWithoutVariation },
    });
  }

  return facts;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// --------------------------------------------------------------- formatting --

/**
 * Money and percentages inside a sentence, in the reader's own convention.
 * Written out by hand rather than through Intl: the figures are whole euro,
 * the two conventions differ by one separator, and a formatter that depends
 * on the ICU data a given Node build happens to carry is a formatter that
 * prints differently on the ΟΚΥπΥ server than it does here.
 */
export function formatEuro(value: number, locale: "el" | "en"): string {
  const grouped = grouped3(Math.round(Math.abs(value)), locale === "el" ? "." : ",");
  const sign = value < 0 ? "-" : "";
  return locale === "el" ? `${sign}${grouped} €` : `€${sign}${grouped}`;
}

export function formatPct(value: number, locale: "el" | "en"): string {
  const fixed = value.toFixed(1);
  return `${locale === "el" ? fixed.replace(".", ",") : fixed}%`;
}

/** ISO date as dd/mm/yyyy, which is how both languages write one in Cyprus. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function grouped3(value: number, separator: string): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}
