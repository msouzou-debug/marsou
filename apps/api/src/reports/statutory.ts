/**
 * R39, CAPEX-01 §11 — «Statutory compliance: lifts, pressure vessels,
 * medical gas, fire systems — due, done, overdue». The mapping of ADR-0032
 * §4 and the counting, pure, so both can be tested without a database.
 */
import {
  type StatutoryCategory,
  StatutoryCategory as StatutoryCategoryEnum,
} from "@ecapital/shared";

/** The order every report prints the four categories in. */
export const STATUTORY_ORDER: StatutoryCategory[] = [...StatutoryCategoryEnum.options];

/** What an order knows about the plant it is on: its asset and its catalogue line. */
export interface StatutoryFacts {
  /** The asset's register class and the catalogue line's, either may be null. */
  assetClasses: (string | null)[];
  /** The asset's shutdown system and the catalogue line's. */
  permitSystems: (string | null)[];
  /** The catalogue line's name, as the contract prints it. */
  systemName: string | null;
}

/** Lower case, no accents: «Λέβητες» and «ΛΕΒΗΤΕΣ» both read «λεβητες». */
function folded(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** ADR-0032 §4: «ατμ» (steam) and «λέβητ» (boilers), folded. */
const PRESSURE_WORDS = ["ατμ", "λεβητ"];

/**
 * Classes whose catalogue line may *mention* a boiler room without being a
 * pressure system: Nicosia's 2.1.3 is power distribution «… περιλαμβανομένων
 * μηχανοστασίων/λεβητοστασίων». A line classed as one of these is never a
 * pressure vessel by its name alone.
 */
const NOT_PRESSURE_BY_NAME = new Set(["ELECTRICAL", "IT"]);

/**
 * RULE (ADR-0032 §4):
 *   LIFTS             asset class LIFT;
 *   MEDICAL_GAS       asset class or permit system MEDICAL_GAS;
 *   FIRE_SYSTEMS      asset class or permit system FIRE;
 *   PRESSURE_VESSELS  permit system STEAM, or a system whose name has «ατμ»
 *                     or «λέβητ» (unless the line is classed electrical/IT).
 * The explicit classes are read first, so a medical-gas line that happens to
 * mention steam stays medical gas. Matching none is null: not counted.
 */
export function statutoryCategoryOf(facts: StatutoryFacts): StatutoryCategory | null {
  const classes = new Set(facts.assetClasses.filter((c): c is string => c !== null));
  const systems = new Set(facts.permitSystems.filter((s): s is string => s !== null));
  if (classes.has("LIFT")) return "LIFTS";
  if (classes.has("MEDICAL_GAS") || systems.has("MEDICAL_GAS")) return "MEDICAL_GAS";
  if (classes.has("FIRE") || systems.has("FIRE")) return "FIRE_SYSTEMS";
  if (systems.has("STEAM")) return "PRESSURE_VESSELS";
  const excluded = [...classes, ...systems].some((c) => NOT_PRESSURE_BY_NAME.has(c));
  if (!excluded && facts.systemName) {
    const name = folded(facts.systemName);
    if (PRESSURE_WORDS.some((word) => name.includes(word))) return "PRESSURE_VESSELS";
  }
  return null;
}

/** One programme or statutory order the year owes, already categorised. */
export interface StatutoryOrder {
  orgUnitId: string;
  category: StatutoryCategory;
  status: string;
  /** The instant the order is due by: its programme date's end, or its restore deadline. */
  deadline: string | null;
  completedAt: string | null;
}

export interface StatutoryCount {
  category: StatutoryCategory;
  due: number;
  done: number;
  overdue: number;
  donePct: number | null;
}

/**
 * RULE (ADR-0032 §4): «due» is every order the year owes — a programme
 * order dated in the year and a STATUTORY order called in it (the caller
 * picks those); «done» is completed by its deadline; «overdue» is past its
 * deadline and not completed. An order completed late is due and neither
 * done nor overdue: it was not done on time and it is no longer owed. A
 * cancelled order is not owed at all. An order with no deadline is done once
 * completed and never overdue.
 *
 * Every category comes back, zeros included, in STATUTORY_ORDER.
 */
export function statutoryCounts(orders: StatutoryOrder[], now: string): StatutoryCount[] {
  const at = Date.parse(now);
  return STATUTORY_ORDER.map((category) => {
    const mine = orders.filter((o) => o.category === category && o.status !== "CANCELLED");
    let done = 0;
    let overdue = 0;
    for (const order of mine) {
      const deadline = order.deadline ? Date.parse(order.deadline) : null;
      const completed = order.status === "COMPLETED" && order.completedAt !== null;
      if (completed) {
        if (deadline === null || Date.parse(order.completedAt as string) <= deadline) done += 1;
      } else if (deadline !== null && deadline < at) {
        overdue += 1;
      }
    }
    return {
      category,
      due: mine.length,
      done,
      overdue,
      donePct: mine.length ? Math.round((done / mine.length) * 1000) / 10 : null,
    };
  });
}
