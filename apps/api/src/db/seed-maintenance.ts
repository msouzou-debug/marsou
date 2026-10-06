/**
 * The M5 half of the seed: maintenance (R32–R37, ADR-0031).
 *
 * Nicosia gets the real agreement — Α.Ο 42/24, the 48 systems of its
 * response-time table with the bands and hours exactly as printed
 * (fixtures/ngh-sla-catalogue.json), the PM frequencies matched from its
 * programme tables, twelve programme lines on seeded assets, about three
 * months of work orders in every state and a backlog with two auto-drafted
 * items. Larnaca gets a smaller agreement and a handful of orders, so the
 * unit filter has something to filter. The penalty rates are null: the
 * Nicosia amounts did not survive the copy we were given and the seed does
 * not invent them (ADR-0031 §2).
 *
 * Run as the migration role, which owns the tables and is not filtered by
 * row-level security. Re-running updates in place and never duplicates: an
 * agreement is found by (unit, ref), a catalogue line by (agreement, code),
 * a programme line by (agreement, title), a work order and a backlog item
 * by (unit, title) — every seeded title is unique for exactly that reason —
 * and a work order that is already there keeps the reference it was given.
 *
 * Times are relative to the moment the seed runs, like the asset readings,
 * because «three hours ago» is a fact about the clock and an open call that
 * was seeded a month ago would be a different demo. Everything else is fixed.
 *
 * NO PATIENT DATA. Machines, rooms, clocks, money and staff names.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addHours, type PmFrequency, type SlaBand } from "@ecapital/shared";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  addDays,
  addWorkingDays,
  historyText,
  nicosiaYear,
  pmDeadlines,
  todayInNicosia,
} from "../maintenance/maintenance-rules";
import { parseFrequencies } from "../maintenance/sla-import";
import * as schema from "./schema";
import { seedAssets } from "./seed-data";

type Db = NodePgDatabase<typeof schema>;

export interface MaintenanceSeedSummary {
  maintenanceContracts: number;
  slaSystems: number;
  pmSchedules: number;
  workOrders: number;
  workOrderEvents: number;
  backlogItems: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ------------------------------------------------------------ fixture --

interface CatalogueFixture {
  responseTimes: {
    code: string;
    band: SlaBand;
    nameEl: string;
    responseH: number;
    restoreH: number;
    reportH: number;
  }[];
  pmProgramme: { n: number; nameEl: string; frequencies: string[] }[];
}

function catalogue(): CatalogueFixture {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "ngh-sla-catalogue.json"), "utf8"),
  ) as CatalogueFixture;
}

/**
 * The programme has two tables, mechanical then electrical, each numbered
 * from 1. A row is `M<n>` or `E<n>`: the numbering restarting is what says
 * the second table began.
 */
function programmeByKey(rows: CatalogueFixture["pmProgramme"]): Map<string, PmFrequency[]> {
  const out = new Map<string, PmFrequency[]>();
  let group = "M";
  let last = 0;
  for (const row of rows) {
    if (row.n <= last && group === "M") group = "E";
    last = row.n;
    out.set(`${group}${row.n}`, parseFrequencies(row.frequencies.join(", ")) ?? []);
  }
  return out;
}

/**
 * Which programme rows each catalogue line's frequencies come from, matched
 * by what the two tables call the equipment. Where nothing in the programme
 * names the system (lighting, the kitchen, the telephones) the line has no
 * frequency and nobody pretends otherwise.
 */
const PM_MATCH: Record<string, string[]> = {
  "1.1.1": ["M3"],
  "1.1.2": ["M19", "M20"],
  "1.1.3": ["M17", "M34"],
  "1.1.4": ["M18"],
  "1.2.1": ["M1", "M2", "M3", "M4", "M6", "M12", "M13"],
  "1.2.2": ["M14", "M35"],
  "1.2.3": ["M17", "M33", "M34"],
  "1.2.4": ["M22"],
  "1.2.5": ["M15"],
  "1.2.6": ["M23"],
  "1.2.7": ["M27", "M31"],
  "1.2.9": ["M10"],
  "1.2.10": ["M42"],
  "1.2.11": ["M41"],
  "1.3.1": ["M16", "M32"],
  "1.3.2": ["M24"],
  "1.3.3": ["M26"],
  "1.3.4": ["M27", "M31"],
  "1.3.5": ["M28"],
  "1.3.6": ["M27"],
  "1.3.7": ["M40"],
  "2.1.2": ["E21"],
  "2.1.3": ["E6"],
  "2.2.1": ["E5"],
  "2.2.2": ["E6"],
  "2.2.3": ["E7"],
  "2.2.5": ["E8"],
  "2.2.6": ["E9"],
  "2.2.7": ["E21"],
  "2.2.8": ["E12"],
  "2.2.9": ["E13"],
  "2.2.10": ["E14"],
  "2.2.11": ["E15"],
  "2.2.12": ["E16"],
  "2.2.13": ["E17"],
  "2.2.14": ["E18"],
  "2.2.15": ["E19"],
  "2.2.16": ["E20"],
  "2.2.17": ["E22"],
  "2.3.1": ["E1"],
  "2.3.2": ["E3"],
  "2.3.3": ["E4"],
  "2.3.4": ["E10"],
  "2.3.5": ["E11"],
};

type AssetClassValue = (typeof schema.assetClass.enumValues)[number];
type PermitSystemValue = (typeof schema.permitSystem.enumValues)[number];

/**
 * The register class and the shutdown system, where the line plainly is
 * one. A WATER asset picks up 1.1.2 by itself because it is the only WATER
 * line; drainage is a permit system and not a register class, so those
 * lines carry the permit system alone.
 */
const MAPPING: Record<string, [AssetClassValue | null, PermitSystemValue | null]> = {
  "1.1.1": ["HVAC", "HVAC"],
  "1.1.2": ["WATER", "WATER"],
  "1.1.3": ["MEDICAL_GAS", "MEDICAL_GAS"],
  "1.2.1": ["HVAC", "HVAC"],
  "1.2.2": ["HVAC", "HVAC"],
  "1.2.3": ["MEDICAL_GAS", "MEDICAL_GAS"],
  "1.2.4": ["FIRE", "FIRE"],
  "1.2.7": [null, "DRAINAGE"],
  "1.2.9": [null, "STEAM"],
  "1.2.10": [null, "STEAM"],
  "1.3.4": [null, "DRAINAGE"],
  "1.3.5": [null, "DRAINAGE"],
  "1.3.6": [null, "DRAINAGE"],
  "2.1.1": ["ELECTRICAL", "ELECTRICAL"],
  "2.1.3": ["ELECTRICAL", "ELECTRICAL"],
  "2.2.1": ["ELECTRICAL", "ELECTRICAL"],
  "2.2.2": ["ELECTRICAL", "ELECTRICAL"],
  "2.2.3": ["ELECTRICAL", "ELECTRICAL"],
  "2.2.4": ["ELECTRICAL", "ELECTRICAL"],
  "2.2.5": ["ELECTRICAL", "ELECTRICAL"],
  "2.2.6": ["ELECTRICAL", "ELECTRICAL"],
  "2.2.11": ["FIRE", "FIRE"],
  "2.2.12": ["FIRE", "FIRE"],
  "2.2.16": ["IT", "IT"],
  "2.2.18": ["IT", "IT"],
  "2.3.1": ["ELECTRICAL", "ELECTRICAL"],
  "2.3.2": ["ELECTRICAL", "ELECTRICAL"],
  "2.3.3": ["ELECTRICAL", "ELECTRICAL"],
  "2.3.4": ["ELECTRICAL", "ELECTRICAL"],
  "2.3.5": ["ELECTRICAL", "ELECTRICAL"],
};

/** Larnaca's smaller agreement: eight lines of the same table, same hours. */
const LARNACA_CODES = ["1.1.1", "1.1.3", "1.2.1", "1.2.4", "2.1.3", "2.2.5", "2.2.6", "2.2.11"];

interface ContractSeed {
  orgUnitId: string;
  ref: string;
  titleEl: string;
  contractorName: string;
  startDate: string;
  endDate: string;
}

const CONTRACTS: ContractSeed[] = [
  {
    orgUnitId: "nicosia-general",
    ref: "Α.Ο 42/24",
    titleEl: "Συντήρηση ηλεκτρομηχανολογικών εγκαταστάσεων ΓΝ Λευκωσίας",
    contractorName: "Ιωνάς Ηλεκτρομηχανολογικά Έργα Λτδ",
    startDate: "2026-01-01",
    endDate: "2031-12-31",
  },
  {
    orgUnitId: "larnaca-general",
    ref: "Α.Ο 17/25",
    titleEl: "Συντήρηση ηλεκτρομηχανολογικών εγκαταστάσεων ΓΝ Λάρνακας",
    contractorName: "Thermotec Μηχανολογικές Εγκαταστάσεις Λτδ",
    startDate: "2026-03-01",
    endDate: "2029-02-28",
  },
];

// --------------------------------------------------------- the programme --

interface ScheduleSeed {
  unit: string;
  code: string;
  assetKey: string;
  titleEl: string;
  frequency: PmFrequency;
  /** Days from today; negative is overdue. */
  dueInDays: number;
  checklistEl: string;
}

const SCHEDULES: ScheduleSeed[] = [
  { unit: "nicosia-general", code: "1.2.1", assetKey: "ngh-ahu-1", titleEl: "Τριμηνιαία συντήρηση ΚΚΜ-1", frequency: "QUARTERLY", dueInDays: -5, checklistEl: "Έλεγχος και αλλαγή φίλτρων\nΈλεγχος ιμάντων και ρουλεμάν\nΚαθαρισμός στοιχείων\nΈλεγχος αποχέτευσης συμπυκνωμάτων" },
  { unit: "nicosia-general", code: "1.2.1", assetKey: "ngh-ahu-2", titleEl: "Τριμηνιαία συντήρηση ΚΚΜ-2", frequency: "QUARTERLY", dueInDays: 25, checklistEl: "Έλεγχος και αλλαγή φίλτρων\nΈλεγχος ιμάντων και ρουλεμάν\nΚαθαρισμός στοιχείων" },
  { unit: "nicosia-general", code: "1.2.1", assetKey: "ngh-ahu-1-fan", titleEl: "Εξαμηνιαία συντήρηση ανεμιστήρα προσαγωγής ΚΚΜ-1", frequency: "SEMIANNUAL", dueInDays: 47, checklistEl: "Έλεγχος κραδασμών\nΛίπανση ρουλεμάν\nΜέτρηση ρεύματος κινητήρα" },
  { unit: "nicosia-general", code: "1.2.1", assetKey: "ngh-chiller-1", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-1", frequency: "MONTHLY", dueInDays: 8, checklistEl: "Καταγραφή πιέσεων και θερμοκρασιών\nΈλεγχος διαρροών ψυκτικού\nΈλεγχος ελαίου συμπιεστών" },
  { unit: "nicosia-general", code: "1.2.3", assetKey: "ngh-mgas-manifold", titleEl: "Τριμηνιαία συντήρηση συστοιχίας ιατρικών αερίων", frequency: "QUARTERLY", dueInDays: 40, checklistEl: "Έλεγχος πιέσεων γραμμών\nΈλεγχος συναγερμών\nΈλεγχος βαλβίδων αποκοπής" },
  { unit: "nicosia-general", code: "2.2.1", assetKey: "ngh-lv-board", titleEl: "Εξαμηνιαία συντήρηση κεντρικού πίνακα χαμηλής τάσης", frequency: "SEMIANNUAL", dueInDays: 53, checklistEl: "Θερμογράφηση\nΣύσφιξη ακροδεκτών\nΈλεγχος διακοπτών" },
  { unit: "nicosia-general", code: "2.2.5", assetKey: "ngh-generator", titleEl: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-1", frequency: "MONTHLY", dueInDays: -2, checklistEl: "Δοκιμή εκκίνησης υπό φορτίο\nΈλεγχος στάθμης καυσίμου\nΈλεγχος συσσωρευτών" },
  { unit: "nicosia-general", code: "2.2.6", assetKey: "ngh-ups", titleEl: "Εξαμηνιαία συντήρηση UPS-1", frequency: "SEMIANNUAL", dueInDays: 60, checklistEl: "Δοκιμή αυτονομίας συσσωρευτών\nΈλεγχος ανεμιστήρων\nΚαταγραφή συναγερμών" },
  { unit: "nicosia-general", code: "2.2.11", assetKey: "ngh-fire-panel", titleEl: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", frequency: "QUARTERLY", dueInDays: 12, checklistEl: "Δοκιμή ανιχνευτών ανά ζώνη\nΈλεγχος σειρήνων\nΈλεγχος εφεδρικής τροφοδοσίας" },
  { unit: "nicosia-general", code: "1.2.4", assetKey: "ngh-sprinkler-pump", titleEl: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης", frequency: "MONTHLY", dueInDays: 28, checklistEl: "Δοκιμή εκκίνησης αντλιών\nΈλεγχος πιεστικού δοχείου\nΚαταγραφή πίεσης δικτύου" },
  { unit: "nicosia-general", code: "1.1.2", assetKey: "ngh-booster", titleEl: "Μηνιαία συντήρηση πιεστικού ύδρευσης", frequency: "MONTHLY", dueInDays: 3, checklistEl: "Έλεγχος πιεστικού δοχείου\nΈλεγχος στυπιοθλιπτών\nΚαταγραφή πίεσης" },
  { unit: "nicosia-general", code: "2.2.16", assetKey: "ngh-server-rack", titleEl: "Ετήσιος έλεγχος δομημένης καλωδίωσης κτιρίου Α", frequency: "ANNUAL", dueInDays: 32, checklistEl: "Έλεγχος σημάνσεων\nΔοκιμή δειγματοληπτικών απολήξεων" },
];

// ---------------------------------------------------------- the orders --

type Kind = "CORRECTIVE" | "PM" | "STATUTORY";
type Status = (typeof schema.workOrderStatus.enumValues)[number];

interface OrderSeed {
  unit: string;
  titleEl: string;
  kind: Kind;
  status: Status;
  source: (typeof schema.workOrderSource.enumValues)[number];
  code: string | null;
  assetKey: string | null;
  areaCode?: string;
  /** PM: the programme line, by title. */
  scheduleTitle?: string;
  /** Hours ago the call was sent (corrective) or, for PM, days ago of the programme date. */
  calledHoursAgo?: number;
  pmDueDaysAgo?: number;
  /** Hours after the call. */
  respondedH?: number;
  restoredH?: number;
  completedH?: number;
  reportH?: number;
  cancelledH?: number;
  extensionDays?: number;
  extensionReasonEl?: string;
  codes?: [
    (typeof schema.failureCode.enumValues)[number],
    (typeof schema.causeCode.enumValues)[number],
    (typeof schema.remedyCode.enumValues)[number],
  ];
  costActual?: number;
  costEstimate?: number;
  escalated?: boolean;
  noteEl?: string;
  by: string;
  assignedToEl?: string;
}

const D = 24;

const ORDERS: OrderSeed[] = [
  // Three on the booster pump inside twelve months: the repeat count and the
  // first auto-drafted backlog item (R36).
  { unit: "nicosia-general", titleEl: "Διαρροή στο πιεστικό ύδρευσης", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.1.2", assetKey: "ngh-booster", calledHoursAgo: 80 * D, respondedH: 0.4, restoredH: 1.5, completedH: 20, reportH: 20, codes: ["LEAK", "WEAR", "REPLACE_PART"], costActual: 1800, by: "dev-technician-nicosia", assignedToEl: "Μ. Ευαγγέλου" },
  { unit: "nicosia-general", titleEl: "Το πιεστικό ύδρευσης δεν αποδίδει πίεση", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "1.1.2", assetKey: "ngh-booster", calledHoursAgo: 45 * D, respondedH: 0.6, restoredH: 3, completedH: 30, reportH: 30, codes: ["NO_OUTPUT", "POWER_SUPPLY", "RESET"], costActual: 650, by: "dev-clinical-nicosia", assignedToEl: "Μ. Ευαγγέλου" },
  { unit: "nicosia-general", titleEl: "Θόρυβος και κραδασμοί στο πιεστικό ύδρευσης", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.1.2", assetKey: "ngh-booster", calledHoursAgo: 6 * D, respondedH: 0.3, restoredH: 1.8, completedH: 22, reportH: 22, codes: ["NOISE_VIBRATION", "WEAR", "REPLACE_PART"], costActual: 2400, by: "dev-technician-nicosia", assignedToEl: "Σ. Πετρίδης" },
  // One repair worth more than half the fan's replacement estimate: the
  // second auto-drafted item.
  { unit: "nicosia-general", titleEl: "Βλάβη κινητήρα ανεμιστήρα απαγωγής ΚΚΜ-2", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "ngh-ahu-2-fan", calledHoursAgo: 30 * D, respondedH: 0.4, restoredH: 20, completedH: 44, reportH: 44, codes: ["ELECTRICAL_FAULT", "WEAR", "REPLACE_UNIT"], costActual: 5200, by: "dev-technician-nicosia", assignedToEl: "Α. Κυπριανού" },
  // The extension: a compressor part imported, restore moved by working days.
  { unit: "nicosia-general", titleEl: "Εκτός λειτουργίας συμπιεστής ψύκτη Ψ-1", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "ngh-chiller-1", calledHoursAgo: 20 * D, respondedH: 0.25, restoredH: 6 * D, completedH: 7 * D, reportH: 40, extensionDays: 5, extensionReasonEl: "Εισαγωγή ανταλλακτικού συμπιεστή από τον κατασκευαστή, με παραστατικό παραγγελίας.", codes: ["ELECTRICAL_FAULT", "WEAR", "REPLACE_PART"], costActual: 3100, by: "dev-estates-nicosia", assignedToEl: "Α. Κυπριανού" },
  { unit: "nicosia-general", titleEl: "Πτώση πίεσης οξυγόνου στη συστοιχία", kind: "CORRECTIVE", status: "RESTORED", source: "NURSING", code: "1.1.3", assetKey: "ngh-mgas-manifold", calledHoursAgo: 2 * D, respondedH: 0.2, restoredH: 3, by: "dev-clinical-nicosia", assignedToEl: "Μ. Ευαγγέλου" },
  // Unanswered past the response time: escalated once.
  { unit: "nicosia-general", titleEl: "Συναγερμός στο ηλεκτροπαραγωγό ζεύγος Η/Ζ-1", kind: "CORRECTIVE", status: "OPEN", source: "TECHNICAL_SERVICES", code: "2.2.5", assetKey: "ngh-generator", calledHoursAgo: 10, escalated: true, by: "dev-technician-nicosia" },
  { unit: "nicosia-general", titleEl: "Ένδειξη σφάλματος στο UPS-1", kind: "CORRECTIVE", status: "ACKNOWLEDGED", source: "VENDOR_ONSITE", code: "2.2.6", assetKey: "ngh-ups", calledHoursAgo: 3, respondedH: 0.33, by: "dev-technician-nicosia", assignedToEl: "Σ. Πετρίδης" },
  { unit: "nicosia-general", titleEl: "Σφάλμα ζώνης 4 στον πίνακα πυρανίχνευσης", kind: "CORRECTIVE", status: "IN_PROGRESS", source: "TECHNICAL_SERVICES", code: "2.2.11", assetKey: "ngh-fire-panel", calledHoursAgo: 5, respondedH: 0.4, by: "dev-engineer-nicosia", assignedToEl: "Γ. Χαραλάμπους" },
  { unit: "nicosia-general", titleEl: "Διαρροή στη βαλβίδα αντλητικού πυρόσβεσης", kind: "CORRECTIVE", status: "PAUSED", source: "VENDOR_ONSITE", code: "1.2.4", assetKey: "ngh-sprinkler-pump", calledHoursAgo: 26, respondedH: 0.5, noteEl: "Αναμονή ανταλλακτικού βαλβίδας.", by: "dev-technician-nicosia", assignedToEl: "Γ. Χαραλάμπους" },
  { unit: "nicosia-general", titleEl: "Υπερθέρμανση ακροδέκτη στον κεντρικό πίνακα", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "2.2.1", assetKey: "ngh-lv-board", calledHoursAgo: 60 * D, respondedH: 0.3, restoredH: 6, completedH: 26, reportH: 26, codes: ["ELECTRICAL_FAULT", "WEAR", "ADJUST"], costActual: 420, by: "dev-engineer-nicosia" },
  { unit: "nicosia-general", titleEl: "Χαμηλή παροχή αέρα από την ΚΚΜ-1", kind: "CORRECTIVE", status: "OPEN", source: "NURSING", code: "1.2.1", assetKey: "ngh-ahu-1", calledHoursAgo: 0.25, by: "dev-clinical-nicosia" },
  { unit: "nicosia-general", titleEl: "Υπερχείλιση φρεατίου αποχέτευσης στο μηχανοστάσιο", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.2.7", assetKey: null, areaCode: "PLT-01", calledHoursAgo: 12 * D, respondedH: 0.4, restoredH: 8, completedH: 70, reportH: 70, codes: ["DAMAGE", "EXTERNAL", "CLEAN"], costActual: 380, by: "dev-technician-nicosia" },
  { unit: "nicosia-general", titleEl: "Διπλή κλήση για την ΚΚΜ-2", kind: "CORRECTIVE", status: "CANCELLED", source: "NURSING", code: "1.2.1", assetKey: "ngh-ahu-2", calledHoursAgo: 40 * D, cancelledH: 0.2, noteEl: "Διπλή καταχώριση της ίδιας κλήσης.", by: "dev-clinical-nicosia" },
  { unit: "nicosia-general", titleEl: "Ετήσια επιθεώρηση πυροσβεστήρων κτιρίου Α", kind: "STATUTORY", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.2.4", assetKey: null, areaCode: "OFF-01", calledHoursAgo: 25 * D, respondedH: 0.3, restoredH: 20, completedH: 30, reportH: 30, costActual: 950, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Απώλεια επικοινωνίας BMS με τους ελεγκτές", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.3.3", assetKey: null, areaCode: "OFF-01", calledHoursAgo: 50 * D, respondedH: 0.4, restoredH: 60, completedH: 80, reportH: 80, codes: ["CONTROL_FAULT", "DESIGN", "RESET"], costActual: 0, by: "dev-engineer-nicosia" },
  { unit: "nicosia-general", titleEl: "Σφάλμα πυκνωτών διόρθωσης συντελεστή ισχύος", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.3.4", assetKey: null, areaCode: "PLT-01", calledHoursAgo: 70 * D, respondedH: 0.8, restoredH: 30, completedH: 50, reportH: 50, codes: ["ELECTRICAL_FAULT", "WEAR", "REPLACE_PART"], costActual: 1250, by: "dev-technician-nicosia" },
  { unit: "nicosia-general", titleEl: "Υψηλή θερμοκρασία στο χειρουργείο 1", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "1.1.1", assetKey: null, areaCode: "THE-01", calledHoursAgo: 35 * D, respondedH: 0.3, restoredH: 5, completedH: 26, reportH: 26, codes: ["CONTROL_FAULT", "LACK_OF_PM", "ADJUST"], costActual: 0, by: "dev-clinical-nicosia" },

  // The programme's own orders: on time, late, and one open.
  { unit: "nicosia-general", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-1 — Αύγουστος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "ngh-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-1", pmDueDaysAgo: 52, completedH: -24, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-1 — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "ngh-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-1", pmDueDaysAgo: 22, completedH: -6, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία δοκιμή Η/Ζ-1 — Αύγουστος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "ngh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-1", pmDueDaysAgo: 63, completedH: 3 * D, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία δοκιμή Η/Ζ-1 — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "ngh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-1", pmDueDaysAgo: 32, completedH: 2, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Τριμηνιαίος έλεγχος πυρανίχνευσης — Ιούλιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.11", assetKey: "ngh-fire-panel", scheduleTitle: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", pmDueDaysAgo: 78, completedH: -48, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Τριμηνιαία συντήρηση ΚΚΜ-1 — Ιούλιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "ngh-ahu-1", scheduleTitle: "Τριμηνιαία συντήρηση ΚΚΜ-1", pmDueDaysAgo: 85, completedH: 2 * D, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία συντήρηση πιεστικού ύδρευσης — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.1.2", assetKey: "ngh-booster", scheduleTitle: "Μηνιαία συντήρηση πιεστικού ύδρευσης", pmDueDaysAgo: 27, completedH: -3, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης — Οκτώβριος", kind: "PM", status: "IN_PROGRESS", source: "PM_PROGRAMME", code: "1.2.4", assetKey: "ngh-sprinkler-pump", scheduleTitle: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης", pmDueDaysAgo: 2, by: "dev-estates-nicosia" },

  // Larnaca: enough for the unit filter to have something to filter.
  { unit: "larnaca-general", titleEl: "Διαρροή νερού από την ΚΚΜ-Λ1", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "lar-ahu-1", calledHoursAgo: 33 * D, respondedH: 0.4, restoredH: 10, completedH: 30, reportH: 30, codes: ["LEAK", "WEAR", "REPAIR"], costActual: 540, by: "dev-engineer-larnaca" },
  { unit: "larnaca-general", titleEl: "Ο ψύκτης Ψ-Λ1 σταματά με σφάλμα υψηλής πίεσης", kind: "CORRECTIVE", status: "OPEN", source: "TECHNICAL_SERVICES", code: "1.2.1", assetKey: "lar-chiller-1", calledHoursAgo: 0.2, by: "dev-engineer-larnaca" },
  { unit: "larnaca-general", titleEl: "Σφάλμα βρόχου στον πίνακα πυρανίχνευσης νέας πτέρυγας", kind: "CORRECTIVE", status: "IN_PROGRESS", source: "VENDOR_ONSITE", code: "2.2.11", assetKey: "lar-fire-panel", calledHoursAgo: 7, respondedH: 0.5, by: "dev-engineer-larnaca" },
];

// ---------------------------------------------------------- the backlog --

interface BacklogSeed {
  unit: string;
  titleEl: string;
  kind: (typeof schema.backlogKind.enumValues)[number];
  riskBand: (typeof schema.riskBand.enumValues)[number];
  costEstimate: number | null;
  assetKey: string | null;
  code: string | null;
  status: (typeof schema.backlogStatus.enumValues)[number];
  descriptionEl: string;
  /** Auto-drafted from these orders by R36. */
  auto?: { reason: "THREE_CORRECTIVE_IN_12_MONTHS" | "REPAIR_COST_OVER_THRESHOLD"; orderTitles: string[] };
  /** FUNDED against the seeded project with this title. */
  projectTitle?: string;
  closedDaysAgo?: number;
  by: string | null;
}

const BACKLOG: BacklogSeed[] = [
  {
    unit: "nicosia-general",
    titleEl: "Αντικατάσταση: Πιεστικό συγκρότημα ύδρευσης",
    kind: "REPLACEMENT",
    riskBand: "SIGNIFICANT",
    costEstimate: null,
    assetKey: "ngh-booster",
    code: "1.1.2",
    status: "OPEN",
    descriptionEl: "Τρεις ή περισσότερες διορθωτικές εντολές στο ίδιο πάγιο μέσα σε δώδεκα μήνες.",
    auto: {
      reason: "THREE_CORRECTIVE_IN_12_MONTHS",
      orderTitles: [
        "Διαρροή στο πιεστικό ύδρευσης",
        "Το πιεστικό ύδρευσης δεν αποδίδει πίεση",
        "Θόρυβος και κραδασμοί στο πιεστικό ύδρευσης",
      ],
    },
    by: null,
  },
  {
    unit: "nicosia-general",
    titleEl: "Αντικατάσταση: Ανεμιστήρας απαγωγής ΚΚΜ-2",
    kind: "REPLACEMENT",
    riskBand: "MODERATE",
    costEstimate: null,
    assetKey: "ngh-ahu-2-fan",
    code: "1.2.1",
    status: "OPEN",
    descriptionEl:
      "Το κόστος επισκευών των τελευταίων δώδεκα μηνών ξεπερνά το όριο επί της εκτίμησης αντικατάστασης.",
    auto: {
      reason: "REPAIR_COST_OVER_THRESHOLD",
      orderTitles: ["Βλάβη κινητήρα ανεμιστήρα απαγωγής ΚΚΜ-2"],
    },
    by: null,
  },
  {
    unit: "nicosia-general",
    titleEl: "Αναβάθμιση κεντρικού πίνακα πυρανίχνευσης",
    kind: "UPGRADE",
    riskBand: "HIGH",
    costEstimate: 78000,
    assetKey: "ngh-fire-panel",
    code: "2.2.11",
    status: "FUNDED",
    descriptionEl: "Ο πίνακας δεν υποστηρίζει πλέον ανταλλακτικά από τον κατασκευαστή.",
    projectTitle: "Αναβάθμιση συστήματος πυρανίχνευσης",
    by: "dev-estates-nicosia",
  },
  {
    unit: "nicosia-general",
    titleEl: "Αναβάθμιση λογισμικού και ελεγκτών BMS",
    kind: "UPGRADE",
    riskBand: "SIGNIFICANT",
    costEstimate: 85000,
    assetKey: null,
    code: "1.3.3",
    status: "OPEN",
    descriptionEl: "Οι ελεγκτές του BMS χάνουν την επικοινωνία· το λογισμικό είναι εκτός υποστήριξης.",
    by: "dev-engineer-nicosia",
  },
  {
    unit: "nicosia-general",
    titleEl: "Επισκευή στεγάνωσης δώματος κτιρίου Α πάνω από το μηχανοστάσιο",
    kind: "REPAIR",
    riskBand: "LOW",
    costEstimate: 12000,
    assetKey: "ngh-roof",
    code: null,
    status: "DONE",
    descriptionEl: "Τοπική αποκατάσταση στεγάνωσης μετά από εισροή νερού.",
    closedDaysAgo: 20,
    by: "dev-engineer-nicosia",
  },
  {
    unit: "larnaca-general",
    titleEl: "Πιστοποίηση δικτύου ιατρικών αερίων νέας πτέρυγας",
    kind: "STATUTORY",
    riskBand: "HIGH",
    costEstimate: 6500,
    assetKey: null,
    code: "1.1.3",
    status: "OPEN",
    descriptionEl: "Η περιοδική πιστοποίηση του δικτύου έληξε και δεν καλύπτεται από τη σύμβαση.",
    by: "dev-engineer-larnaca",
  },
];

// ----------------------------------------------------------------- run --

export async function seedMaintenanceRegister(db: Db): Promise<MaintenanceSeedSummary> {
  const summary: MaintenanceSeedSummary = {
    maintenanceContracts: 0,
    slaSystems: 0,
    pmSchedules: 0,
    workOrders: 0,
    workOrderEvents: 0,
    backlogItems: 0,
  };
  const now = Date.now();
  const fixture = catalogue();
  const programme = programmeByKey(fixture.pmProgramme);

  const users = await db
    .select({ id: schema.appUser.id, subject: schema.appUser.subject })
    .from(schema.appUser);
  const userBySubject = new Map(users.map((u) => [u.subject, u.id]));

  const assets = await db
    .select({
      id: schema.asset.id,
      orgUnitId: schema.asset.orgUnitId,
      nameEl: schema.asset.nameEl,
      areaId: schema.asset.areaId,
      replacementCostEst: schema.asset.replacementCostEst,
      criticality: schema.asset.criticality,
    })
    .from(schema.asset);
  const assetByKey = new Map<string, (typeof assets)[number]>();
  for (const fixtureAsset of seedAssets) {
    const row = assets.find(
      (a) => a.orgUnitId === fixtureAsset.orgUnitId && a.nameEl === fixtureAsset.nameEl,
    );
    if (row) assetByKey.set(fixtureAsset.key, row);
  }

  const areas = await db
    .select({ id: schema.area.id, code: schema.area.code, orgUnitId: schema.area.orgUnitId })
    .from(schema.area);
  const areaByUnitCode = new Map(areas.map((a) => [`${a.orgUnitId}:${a.code}`, a.id]));

  // ------------------------------------------------- agreements, catalogue --
  const contractIdByUnit = new Map<string, string>();
  const systemByUnitCode = new Map<string, typeof schema.slaSystem.$inferSelect>();

  for (const seed of CONTRACTS) {
    const [contractor] = await db
      .select({ id: schema.contractor.id })
      .from(schema.contractor)
      .where(eq(schema.contractor.name, seed.contractorName))
      .limit(1);
    if (!contractor) continue;

    const values = {
      orgUnitId: seed.orgUnitId,
      contractorId: contractor.id,
      ref: seed.ref,
      titleEl: seed.titleEl,
      startDate: seed.startDate,
      endDate: seed.endDate,
      status: "ACTIVE" as const,
    };
    const [row] = await db
      .insert(schema.maintenanceContract)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.maintenanceContract.orgUnitId, schema.maintenanceContract.ref],
        set: { ...values, updatedAt: sql`now()` },
      })
      .returning({ id: schema.maintenanceContract.id });
    contractIdByUnit.set(seed.orgUnitId, row.id);
    summary.maintenanceContracts += 1;

    const lines =
      seed.orgUnitId === "nicosia-general"
        ? fixture.responseTimes
        : fixture.responseTimes.filter((line) => LARNACA_CODES.includes(line.code));
    for (const line of lines) {
      const frequencies = new Set<PmFrequency>();
      for (const key of PM_MATCH[line.code] ?? []) {
        for (const f of programme.get(key) ?? []) frequencies.add(f);
      }
      const order: PmFrequency[] = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
      const [assetClass, permitSystem] = MAPPING[line.code] ?? [null, null];
      const systemValues = {
        maintenanceContractId: row.id,
        orgUnitId: seed.orgUnitId,
        code: line.code,
        nameEl: line.nameEl,
        band: line.band,
        responseHours: String(line.responseH),
        restoreHours: String(line.restoreH),
        reportHours: String(line.reportH),
        pmFrequencies: order.filter((f) => frequencies.has(f)),
        // ADR-0031 §2: the amounts did not survive the copy. Null, not a guess.
        penaltyPmPerDay: null,
        penaltyResponsePerHour: null,
        penaltyRestorePerHour: null,
        assetClass,
        permitSystem,
        active: true,
      };
      const [system] = await db
        .insert(schema.slaSystem)
        .values(systemValues)
        .onConflictDoUpdate({
          target: [schema.slaSystem.maintenanceContractId, schema.slaSystem.code],
          set: { ...systemValues, updatedAt: sql`now()` },
        })
        .returning();
      systemByUnitCode.set(`${seed.orgUnitId}:${line.code}`, system);
      summary.slaSystems += 1;
    }
  }

  // --------------------------------------------------------- the programme --
  const today = todayInNicosia(new Date(now));
  const scheduleIdByTitle = new Map<string, string>();
  for (const seed of SCHEDULES) {
    const system = systemByUnitCode.get(`${seed.unit}:${seed.code}`);
    const asset = assetByKey.get(seed.assetKey);
    if (!system) continue;
    const values = {
      maintenanceContractId: system.maintenanceContractId,
      slaSystemId: system.id,
      assetId: asset?.id ?? null,
      orgUnitId: seed.unit,
      titleEl: seed.titleEl,
      frequency: seed.frequency,
      checklistEl: seed.checklistEl,
      nextDue: addDays(today, seed.dueInDays),
      leadDays: 14,
      active: true,
    };
    const [existing] = await db
      .select({ id: schema.pmSchedule.id })
      .from(schema.pmSchedule)
      .where(
        and(
          eq(schema.pmSchedule.maintenanceContractId, system.maintenanceContractId),
          eq(schema.pmSchedule.titleEl, seed.titleEl),
        ),
      )
      .limit(1);
    let id: string;
    if (existing) {
      await db
        .update(schema.pmSchedule)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.pmSchedule.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await db
        .insert(schema.pmSchedule)
        .values(values)
        .returning({ id: schema.pmSchedule.id });
      id = row.id;
    }
    scheduleIdByTitle.set(seed.titleEl, id);
    summary.pmSchedules += 1;
  }

  // ------------------------------------------------------------ the orders --
  const orderIdByTitle = new Map<string, { id: string; ref: string; calledAt: Date; cost: number | null }>();
  for (const seed of ORDERS) {
    const system = seed.code ? systemByUnitCode.get(`${seed.unit}:${seed.code}`) : undefined;
    const asset = seed.assetKey ? assetByKey.get(seed.assetKey) : undefined;
    const by = userBySubject.get(seed.by) ?? null;
    const areaId = asset?.areaId ?? (seed.areaCode ? (areaByUnitCode.get(`${seed.unit}:${seed.areaCode}`) ?? null) : null);

    let calledAt: Date;
    let dueDate: string | null = null;
    let dueResponseAt: Date | null = null;
    let dueRestoreBaseAt: Date | null = null;
    let dueRestoreAt: Date | null = null;
    let dueReportAt: Date | null = null;
    if (seed.kind === "PM") {
      dueDate = addDays(today, -(seed.pmDueDaysAgo ?? 0));
      const deadlines = pmDeadlines(dueDate);
      // The sweep issues a line fourteen days ahead, at the start of a day.
      calledAt = new Date(Date.parse(`${addDays(dueDate, -14)}T05:00:00Z`));
      dueRestoreBaseAt = new Date(deadlines.dueRestoreAt);
      dueRestoreAt = new Date(deadlines.dueRestoreAt);
      dueReportAt = new Date(deadlines.dueReportAt);
    } else {
      calledAt = new Date(now - (seed.calledHoursAgo ?? 0) * HOUR_MS);
      if (system) {
        const called = calledAt.toISOString();
        dueResponseAt = new Date(addHours(called, Number(system.responseHours)));
        dueRestoreBaseAt = new Date(addHours(called, Number(system.restoreHours)));
        dueRestoreAt = dueRestoreBaseAt;
        dueReportAt = new Date(addHours(called, Number(system.reportHours)));
        if (seed.extensionDays) {
          dueRestoreAt = new Date(addWorkingDays(dueRestoreBaseAt.toISOString(), seed.extensionDays));
        }
      }
    }
    // PM completion is relative to the programme deadline, corrective to the call.
    const pmBase = dueRestoreAt ?? calledAt;
    const after = (h: number | undefined, base: Date = calledAt): Date | null =>
      h === undefined ? null : new Date(base.getTime() + h * HOUR_MS);
    const completedAt = seed.kind === "PM" ? after(seed.completedH, pmBase) : after(seed.completedH);
    const respondedAt = seed.kind === "PM" ? null : after(seed.respondedH);
    const restoredAt = seed.kind === "PM" ? completedAt : after(seed.restoredH);
    const reportReceivedAt = seed.kind === "PM" ? completedAt : after(seed.reportH);
    const cancelledAt = after(seed.cancelledH);
    // Work started a minute after the response on a corrective order, and a
    // few hours before the deadline (or before it was done) on a visit.
    const working = !["OPEN", "ACKNOWLEDGED", "CANCELLED"].includes(seed.status);
    const startedAt = !working
      ? null
      : seed.kind === "PM"
        ? new Date(Math.min(now, (completedAt ?? pmBase).getTime()) - 4 * HOUR_MS)
        : respondedAt
          ? new Date(respondedAt.getTime() + 60_000)
          : null;
    const escalatedAt =
      seed.escalated && dueResponseAt ? new Date(dueResponseAt.getTime() + 0.5 * HOUR_MS) : null;

    const values = {
      orgUnitId: seed.unit,
      kind: seed.kind,
      status: seed.status,
      source: seed.source,
      maintenanceContractId: system?.maintenanceContractId ?? contractIdByUnit.get(seed.unit) ?? null,
      slaSystemId: system?.id ?? null,
      band: system?.band ?? null,
      assetId: asset?.id ?? null,
      areaId,
      pmScheduleId: seed.scheduleTitle ? (scheduleIdByTitle.get(seed.scheduleTitle) ?? null) : null,
      titleEl: seed.titleEl,
      descriptionEl: null,
      calledAt,
      dueResponseAt,
      dueRestoreBaseAt,
      dueRestoreAt,
      dueReportAt,
      dueDate,
      respondedAt,
      startedAt,
      restoredAt,
      completedAt,
      reportReceivedAt,
      cancelledAt,
      extensionDays: seed.extensionDays ?? 0,
      extensionReasonEl: seed.extensionReasonEl ?? null,
      failureCode: seed.codes?.[0] ?? null,
      causeCode: seed.codes?.[1] ?? null,
      remedyCode: seed.codes?.[2] ?? null,
      costEstimate: seed.costEstimate === undefined ? null : seed.costEstimate.toFixed(2),
      costActual: seed.costActual === undefined ? null : seed.costActual.toFixed(2),
      closeoutNoteEl: seed.status === "COMPLETED" ? "Η εργασία ολοκληρώθηκε και παραδόθηκε έκθεση." : null,
      assignedToEl: seed.assignedToEl ?? null,
      raisedBy: seed.kind === "PM" ? null : by,
      escalatedAt,
    };

    const [existing] = await db
      .select({ id: schema.workOrder.id, ref: schema.workOrder.ref })
      .from(schema.workOrder)
      .where(and(eq(schema.workOrder.orgUnitId, seed.unit), eq(schema.workOrder.titleEl, seed.titleEl)))
      .limit(1);
    let id: string;
    let ref: string;
    if (existing) {
      // The reference is not in the update: it was read out over a phone once.
      await db
        .update(schema.workOrder)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.workOrder.id, existing.id));
      id = existing.id;
      ref = existing.ref;
      await db.delete(schema.workOrderEvent).where(eq(schema.workOrderEvent.workOrderId, id));
    } else {
      const [row] = await db
        .insert(schema.workOrder)
        .values({
          ...values,
          ref: sql`ecapital.allocate_work_order_ref(${seed.unit}::text, ${nicosiaYear(calledAt)}::integer)`,
        })
        .returning({ id: schema.workOrder.id, ref: schema.workOrder.ref });
      id = row.id;
      ref = row.ref;
    }
    orderIdByTitle.set(seed.titleEl, {
      id,
      ref,
      calledAt,
      cost: seed.costActual ?? seed.costEstimate ?? null,
    });
    summary.workOrders += 1;

    // The story, in the order it happened.
    const events: {
      kind: (typeof schema.workOrderEventKind.enumValues)[number];
      at: Date;
      noteEl?: string | null;
      byId: string | null;
    }[] = [{ kind: "CREATED", at: calledAt, byId: seed.kind === "PM" ? null : by }];
    if (respondedAt) events.push({ kind: "ACKNOWLEDGED", at: respondedAt, byId: by });
    if (startedAt) events.push({ kind: "STARTED", at: startedAt, byId: by });
    if (escalatedAt) {
      events.push({ kind: "ESCALATED", at: escalatedAt, byId: null, noteEl: "Ο χρόνος ανταπόκρισης έληξε χωρίς ανταπόκριση του αναδόχου." });
    }
    if (seed.status === "PAUSED") {
      events.push({ kind: "PAUSED", at: new Date(calledAt.getTime() + 2 * HOUR_MS), byId: by, noteEl: seed.noteEl ?? null });
    }
    if (seed.extensionDays) {
      events.push({ kind: "EXTENSION", at: new Date(calledAt.getTime() + 6 * HOUR_MS), byId: userBySubject.get("dev-estates-nicosia") ?? by, noteEl: `${seed.extensionDays} εργάσιμες ημέρες: ${seed.extensionReasonEl}` });
    }
    if (restoredAt && seed.kind !== "PM") events.push({ kind: "RESTORED", at: restoredAt, byId: by });
    if (completedAt) events.push({ kind: "COMPLETED", at: completedAt, byId: by });
    if (cancelledAt) events.push({ kind: "CANCELLED", at: cancelledAt, byId: by, noteEl: seed.noteEl ?? null });
    for (const event of events) {
      await db.insert(schema.workOrderEvent).values({
        workOrderId: id,
        orgUnitId: seed.unit,
        at: event.at,
        byId: event.byId,
        kind: event.kind,
        noteEl: event.noteEl ?? null,
      });
      summary.workOrderEvents += 1;
    }
  }

  // ------------------------------------------------------------ the backlog --
  for (const seed of BACKLOG) {
    const asset = seed.assetKey ? assetByKey.get(seed.assetKey) : undefined;
    const system = seed.code ? systemByUnitCode.get(`${seed.unit}:${seed.code}`) : undefined;
    let targetProjectId: string | null = null;
    if (seed.projectTitle) {
      const [project] = await db
        .select({ id: schema.project.id })
        .from(schema.project)
        .where(and(eq(schema.project.orgUnitId, seed.unit), eq(schema.project.titleEl, seed.projectTitle)))
        .limit(1);
      targetProjectId = project?.id ?? null;
    }
    const sourceOrders = (seed.auto?.orderTitles ?? [])
      .map((title) => orderIdByTitle.get(title))
      .filter((o): o is NonNullable<typeof o> => Boolean(o));
    const source = sourceOrders[sourceOrders.length - 1];
    const status = seed.status === "FUNDED" && !targetProjectId ? "OPEN" : seed.status;

    const values = {
      orgUnitId: seed.unit,
      kind: seed.kind,
      titleEl: seed.titleEl,
      descriptionEl: seed.descriptionEl,
      riskBand: seed.riskBand,
      // An auto-drafted replacement is priced at the asset's own estimate.
      costEstimate: seed.auto
        ? (asset?.replacementCostEst ?? null)
        : seed.costEstimate === null
          ? null
          : seed.costEstimate.toFixed(2),
      assetId: asset?.id ?? null,
      slaSystemId: system?.id ?? null,
      sourceWorkOrderId: source?.id ?? null,
      autoDrafted: Boolean(seed.auto),
      autoReason: seed.auto?.reason ?? null,
      historyEl: seed.auto
        ? historyText(
            sourceOrders.map((o) => ({ ref: o.ref, calledAt: o.calledAt.toISOString(), cost: o.cost })),
          )
        : null,
      status,
      targetProjectId: status === "FUNDED" ? targetProjectId : null,
      raisedBy: seed.by ? (userBySubject.get(seed.by) ?? null) : null,
      raisedAt: source ? new Date(source.calledAt.getTime() + 24 * HOUR_MS) : new Date(now - 30 * DAY_MS),
      closedAt: seed.closedDaysAgo !== undefined ? new Date(now - seed.closedDaysAgo * DAY_MS) : null,
    };
    const [existing] = await db
      .select({ id: schema.backlogItem.id })
      .from(schema.backlogItem)
      .where(and(eq(schema.backlogItem.orgUnitId, seed.unit), eq(schema.backlogItem.titleEl, seed.titleEl)))
      .limit(1);
    let id: string;
    if (existing) {
      await db
        .update(schema.backlogItem)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.backlogItem.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await db.insert(schema.backlogItem).values(values).returning({ id: schema.backlogItem.id });
      id = row.id;
    }
    if (source) {
      await db
        .update(schema.workOrder)
        .set({ backlogItemId: id })
        .where(eq(schema.workOrder.id, source.id));
      const [seen] = await db
        .select({ id: schema.workOrderEvent.id })
        .from(schema.workOrderEvent)
        .where(and(eq(schema.workOrderEvent.workOrderId, source.id), eq(schema.workOrderEvent.kind, "TO_BACKLOG")))
        .limit(1);
      if (!seen) {
        await db.insert(schema.workOrderEvent).values({
          workOrderId: source.id,
          orgUnitId: seed.unit,
          at: values.raisedAt,
          byId: null,
          kind: "TO_BACKLOG",
          noteEl: "Αυτόματη πρόταση αντικατάστασης.",
        });
        summary.workOrderEvents += 1;
      }
    }
    summary.backlogItems += 1;
  }

  return summary;
}
