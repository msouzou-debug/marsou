/**
 * ADR-0035 — the delay penalty («ρήτρα καθυστέρησης»), computed on read and
 * never posted. Pure: the service and the reports load the rows, this turns
 * them into `ContractDelay`, and the unit tests run it without a database.
 *
 * RULE (ADR-0035 §1, §3):
 *   - the clocks are the sections when the contract has any, otherwise one
 *     clock, the contract's own;
 *   - a clock's due date is its contractual completion plus the approved
 *     extensions on that clock, in calendar days (the Larnaca contract counts
 *     calendar days: 03/12/2024 to 11/09/2025 is 282);
 *   - it runs to the handover date, or to `asOf` while the works are open;
 *   - days late × the rate (the section's own, else the contract's) is the
 *     accrued amount, null without a rate;
 *   - the total is null when no late clock has a rate.
 *
 * The activation the head of estates records is shown on the clock and does
 * not change the figure: the contract's clause does not wait for anyone.
 */
import {
  CLAIM_OPEN_STAGES,
  type ClaimDirection,
  type ClaimStage,
  type ContractDelay,
  type DelayClock,
} from "@ecapital/shared";

export interface DelayContractFacts {
  completionDate: string | null;
  liquidatedDamagesPerDay: number | null;
  ldActivatedAt: string | null;
  /**
   * When the contract's own clock stops. A contract has no handover column of
   * its own; the loader passes the project's actual finish where it has one.
   * Ignored when the contract has sections.
   */
  handoverDate?: string | null;
  /** The Greek label of the contract's own clock. */
  titleEl?: string;
}

export interface DelaySectionFacts {
  id: string;
  code: string;
  titleEl: string;
  completionDate: string;
  handoverDate: string | null;
  liquidatedDamagesPerDay: number | null;
  ldActivatedAt: string | null;
  sortOrder: number;
}

export interface DelayExtensionFacts {
  sectionId: string | null;
  days: number;
  contractorCulpable: boolean;
}

export interface DelayClaimFacts {
  direction: ClaimDirection;
  amount: number;
  stage: ClaimStage;
}

export interface DelayInput {
  contract: DelayContractFacts;
  sections: DelaySectionFacts[];
  extensions: DelayExtensionFacts[];
  claims: DelayClaimFacts[];
  /** ISO date the days are counted to: today in Europe/Nicosia on a request. */
  asOf: string;
}

/** The label of the contract's own clock when nobody passes one. */
export const CONTRACT_CLOCK_TITLE_EL = "Σύμβαση";

export function computeDelay(input: DelayInput): ContractDelay {
  const sections = [...input.sections].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "el"),
  );
  const clocks: DelayClock[] = sections.length
    ? sections.map((section) =>
        clock({
          sectionId: section.id,
          sectionCode: section.code,
          titleEl: section.titleEl,
          completionDate: section.completionDate,
          handoverDate: section.handoverDate,
          rate: section.liquidatedDamagesPerDay ?? input.contract.liquidatedDamagesPerDay,
          activatedAt: section.ldActivatedAt,
          extensions: input.extensions.filter((e) => e.sectionId === section.id),
          asOf: input.asOf,
        }),
      )
    : [
        clock({
          sectionId: null,
          sectionCode: null,
          titleEl: input.contract.titleEl ?? CONTRACT_CLOCK_TITLE_EL,
          completionDate: input.contract.completionDate,
          handoverDate: input.contract.handoverDate ?? null,
          rate: input.contract.liquidatedDamagesPerDay,
          activatedAt: input.contract.ldActivatedAt,
          extensions: input.extensions.filter((e) => e.sectionId === null),
          asOf: input.asOf,
        }),
      ];

  const late = clocks.filter((c) => c.daysLate > 0);
  const priced = late.filter((c) => c.amount !== null);
  const open = input.claims.filter((c) => CLAIM_OPEN_STAGES.includes(c.stage));

  return {
    asOf: input.asOf,
    clocks,
    totalDaysLate: clocks.reduce((sum, c) => sum + c.daysLate, 0),
    totalAmount: priced.length ? round2(priced.reduce((sum, c) => sum + (c.amount as number), 0)) : null,
    extensionDays: input.extensions.reduce((sum, e) => sum + e.days, 0),
    openClaims: open.length,
    claimedByContractor: round2(
      open.filter((c) => c.direction === "BY_CONTRACTOR").reduce((sum, c) => sum + c.amount, 0),
    ),
    claimedByOrganisation: round2(
      open.filter((c) => c.direction === "BY_ORGANISATION").reduce((sum, c) => sum + c.amount, 0),
    ),
  };
}

function clock(input: {
  sectionId: string | null;
  sectionCode: string | null;
  titleEl: string;
  completionDate: string | null;
  handoverDate: string | null;
  rate: number | null;
  activatedAt: string | null;
  extensions: DelayExtensionFacts[];
  asOf: string;
}): DelayClock {
  const extensionDays = input.extensions.reduce((sum, e) => sum + e.days, 0);
  const culpableExtensionDays = input.extensions
    .filter((e) => e.contractorCulpable)
    .reduce((sum, e) => sum + e.days, 0);
  const dueDate = input.completionDate === null ? null : plusDays(input.completionDate, extensionDays);
  const end = input.handoverDate ?? input.asOf;
  const daysLate = dueDate === null ? 0 : Math.max(0, calendarDays(dueDate, end));
  return {
    sectionId: input.sectionId,
    sectionCode: input.sectionCode,
    titleEl: input.titleEl,
    completionDate: input.completionDate,
    extensionDays,
    culpableExtensionDays,
    dueDate,
    handoverDate: input.handoverDate,
    daysLate,
    ratePerDay: input.rate,
    amount: input.rate === null ? null : round2(daysLate * input.rate),
    activatedAt: input.activatedAt,
  };
}

/** The ISO date `days` calendar days after `isoDate`. */
export function plusDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export function calendarDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Today in Europe/Nicosia, as an ISO date: the day a Cypriot clerk would write. */
export function nicosiaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Nicosia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
