/**
 * The M5 half of the seed: maintenance (R32–R37, ADR-0031).
 *
 * Nicosia gets the real agreement — Α.Ο 42/24, the 48 systems of its
 * response-time table with the bands and hours exactly as printed
 * (fixtures/ngh-sla-catalogue.json), the PM frequencies matched from its
 * programme tables, twelve programme lines on seeded assets, about six
 * months of work orders in every state and a backlog with three
 * auto-drafted items. Larnaca gets a smaller agreement and a handful of
 * orders, so the unit filter has something to filter. Limassol, Paphos and
 * Famagusta each get an agreement of their own with a catalogue picked from
 * the same table (same codes, bands and hours), a programme, about eighteen
 * orders over the last hundred days and a short backlog — and, because none
 * of the three had a register, a small estate (one building, a few rooms)
 * and nine or ten assets for those orders to point at. Paphos's catalogue
 * leaves out the medical gas lines on purpose: work-orders.test.ts picks a
 * catalogue line from the asset class in a unit nobody else gives an
 * agreement, and that unit is Paphos. The penalty rates are null: the
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
  /** Areas and assets written for the three added units, which had no register. */
  estateAreas: number;
  estateAssets: number;
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

/**
 * Which lines of the table each smaller agreement carries, same codes, bands
 * and hours as Nicosia's. A unit that is not here has the whole table.
 * Paphos has no 1.1.3 and no 1.2.3: its medical gases are under a separate
 * contract (see the header for the other reason).
 */
const CATALOGUE_CODES: Record<string, string[]> = {
  "larnaca-general": ["1.1.1", "1.1.3", "1.2.1", "1.2.4", "2.1.3", "2.2.5", "2.2.6", "2.2.11"],
  "limassol-general": [
    "1.1.1", "1.1.2", "1.1.3", "1.2.1", "1.2.3", "1.2.4", "1.2.7",
    "1.3.3", "2.1.3", "2.2.1", "2.2.5", "2.2.6", "2.2.11", "2.2.16",
  ],
  "paphos-general": [
    "1.1.1", "1.1.2", "1.2.1", "1.2.2", "1.2.4", "1.3.3",
    "2.1.3", "2.2.1", "2.2.5", "2.2.6", "2.2.11", "2.2.16",
  ],
  "famagusta-general": [
    "1.1.1", "1.1.2", "1.1.3", "1.2.1", "1.2.3", "1.2.4",
    "2.1.3", "2.2.1", "2.2.5", "2.2.6", "2.2.11", "2.2.16",
  ],
};
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
  {
    orgUnitId: "limassol-general",
    ref: "Α.Ο 18/25",
    titleEl: "Συντήρηση ηλεκτρομηχανολογικών εγκαταστάσεων ΓΝ Λεμεσού",
    contractorName: "Ιωνάς Ηλεκτρομηχανολογικά Έργα Λτδ",
    startDate: "2025-07-01",
    endDate: "2030-06-30",
  },
  {
    orgUnitId: "paphos-general",
    ref: "Α.Ο 19/25",
    titleEl: "Συντήρηση ηλεκτρομηχανολογικών εγκαταστάσεων ΓΝ Πάφου",
    contractorName: "Thermotec Μηχανολογικές Εγκαταστάσεις Λτδ",
    startDate: "2025-10-01",
    endDate: "2028-09-30",
  },
  {
    orgUnitId: "famagusta-general",
    ref: "Α.Ο 22/25",
    titleEl: "Συντήρηση ηλεκτρομηχανολογικών εγκαταστάσεων ΓΝ Αμμοχώστου",
    contractorName: "Παπαέλληνας Ηλεκτρολογικά Δίκτυα Λτδ",
    startDate: "2026-02-01",
    endDate: "2029-01-31",
  },
];

// ------------------------------------------------- the three added estates --

type AreaTypeValue = (typeof schema.areaType.enumValues)[number];
type RiskGroupValue = (typeof schema.patientRiskGroup.enumValues)[number];

interface EstateSeed {
  orgUnitId: string;
  building: { code: string; nameEl: string; grossAreaM2: string; yearBuilt: number; storeys: number };
  floors: {
    code: string;
    nameEl: string;
    level: number;
    areas: {
      code: string;
      nameEl: string;
      areaType: AreaTypeValue;
      patientRiskGroup: RiskGroupValue;
      costCentre: string;
      beds: number | null;
    }[];
  }[];
}

/**
 * One building with two floors for each of the three hospitals that had
 * none: enough rooms for the orders to name a plant room, a theatre, a ward
 * and an office, nothing more. The seeds that wrote Nicosia's and Larnaca's
 * estates run before this one and are not touched.
 */
const ESTATES: EstateSeed[] = [
  {
    orgUnitId: "limassol-general",
    building: { code: "LGH-A", nameEl: "Κτίριο Α — Κεντρικό Συγκρότημα", grossAreaM2: "21800.00", yearBuilt: 2004, storeys: 2 },
    floors: [
      {
        code: "00", nameEl: "Ισόγειο", level: 0,
        areas: [
          { code: "PLT-01", nameEl: "Μηχανοστάσιο", areaType: "PLANT", patientRiskGroup: "LOW", costCentre: "CC-LMS-TEC", beds: null },
          { code: "OPD-01", nameEl: "Εξωτερικά Ιατρεία", areaType: "OPD", patientRiskGroup: "MEDIUM", costCentre: "CC-LMS-OPD", beds: null },
          { code: "OFF-01", nameEl: "Γραφεία Τεχνικών Υπηρεσιών", areaType: "OFFICE", patientRiskGroup: "LOW", costCentre: "CC-LMS-TEC", beds: null },
        ],
      },
      {
        code: "01", nameEl: "Πρώτος όροφος", level: 1,
        areas: [
          { code: "THE-01", nameEl: "Χειρουργείο 1", areaType: "THEATRE", patientRiskGroup: "HIGHEST", costCentre: "CC-LMS-THE", beds: null },
          { code: "ICU-01", nameEl: "Μονάδα Εντατικής Θεραπείας", areaType: "ICU", patientRiskGroup: "HIGHEST", costCentre: "CC-LMS-ICU", beds: 8 },
          { code: "WRD-01", nameEl: "Θάλαμος Γ1", areaType: "WARD", patientRiskGroup: "HIGH", costCentre: "CC-LMS-WRD", beds: 22 },
        ],
      },
    ],
  },
  {
    orgUnitId: "paphos-general",
    building: { code: "PAF-A", nameEl: "Κτίριο Α — Κύριο Κτίριο", grossAreaM2: "14200.00", yearBuilt: 2008, storeys: 2 },
    floors: [
      {
        code: "00", nameEl: "Ισόγειο", level: 0,
        areas: [
          { code: "PLT-01", nameEl: "Μηχανοστάσιο", areaType: "PLANT", patientRiskGroup: "LOW", costCentre: "CC-PAF-TEC", beds: null },
          { code: "OPD-01", nameEl: "Εξωτερικά Ιατρεία", areaType: "OPD", patientRiskGroup: "MEDIUM", costCentre: "CC-PAF-OPD", beds: null },
          { code: "OFF-01", nameEl: "Γραφεία Τεχνικών Υπηρεσιών", areaType: "OFFICE", patientRiskGroup: "LOW", costCentre: "CC-PAF-TEC", beds: null },
        ],
      },
      {
        code: "01", nameEl: "Πρώτος όροφος", level: 1,
        areas: [
          { code: "THE-01", nameEl: "Χειρουργείο 1", areaType: "THEATRE", patientRiskGroup: "HIGHEST", costCentre: "CC-PAF-THE", beds: null },
          { code: "WRD-01", nameEl: "Θάλαμος Β1", areaType: "WARD", patientRiskGroup: "HIGH", costCentre: "CC-PAF-WRD", beds: 20 },
        ],
      },
    ],
  },
  {
    orgUnitId: "famagusta-general",
    building: { code: "FAM-A", nameEl: "Κτίριο Α — Κεντρικό Κτίριο", grossAreaM2: "11800.00", yearBuilt: 2006, storeys: 2 },
    floors: [
      {
        code: "00", nameEl: "Ισόγειο", level: 0,
        areas: [
          { code: "PLT-01", nameEl: "Μηχανοστάσιο", areaType: "PLANT", patientRiskGroup: "LOW", costCentre: "CC-FAM-TEC", beds: null },
          { code: "OFF-01", nameEl: "Γραφεία Τεχνικών Υπηρεσιών", areaType: "OFFICE", patientRiskGroup: "LOW", costCentre: "CC-FAM-TEC", beds: null },
        ],
      },
      {
        code: "01", nameEl: "Πρώτος όροφος", level: 1,
        areas: [
          { code: "THE-01", nameEl: "Χειρουργείο 1", areaType: "THEATRE", patientRiskGroup: "HIGHEST", costCentre: "CC-FAM-THE", beds: null },
          { code: "WRD-01", nameEl: "Θάλαμος Δ1", areaType: "WARD", patientRiskGroup: "HIGH", costCentre: "CC-FAM-WRD", beds: 16 },
        ],
      },
    ],
  },
];

interface EstateAsset {
  key: string;
  orgUnitId: string;
  areaCode: string | null;
  nameEl: string;
  assetClass: AssetClassValue;
  manufacturer: string;
  model: string;
  /** Installed and commissioned on the same day; the warranty runs three years. */
  installed: string;
  capitalCost: number;
  lifeYears: number;
  replacementYear: number;
  replacementCostEst: number;
  criticality: number;
  condition: "A" | "B" | "C" | "D" | "E";
  system: PermitSystemValue | null;
}

/** The SAP asset-number prefix and cost centre of each added unit, like «ANG-» and «ALA-». */
const ESTATE_CODES: Record<string, { sap: string; costCentre: string }> = {
  "limassol-general": { sap: "ALM", costCentre: "CC-LMS-TEC" },
  "paphos-general": { sap: "APA", costCentre: "CC-PAF-TEC" },
  "famagusta-general": { sap: "AFA", costCentre: "CC-FAM-TEC" },
};

const LGH = "limassol-general";
const PAF = "paphos-general";
const FAM = "famagusta-general";

const ESTATE_ASSETS: EstateAsset[] = [
  // ------------------------------------------------------------ Λεμεσός --
  { key: "lgh-ahu-1", orgUnitId: LGH, areaCode: "PLT-01", nameEl: "Κλιματιστική μονάδα ΚΚΜ-Λε1", assetClass: "HVAC", manufacturer: "Systemair", model: "DV-80", installed: "2005-06-14", capitalCost: 74000, lifeYears: 20, replacementYear: 2028, replacementCostEst: 118000, criticality: 2, condition: "D", system: "HVAC" },
  { key: "lgh-chiller-1", orgUnitId: LGH, areaCode: null, nameEl: "Ψύκτης Ψ-Λε1, δώμα κτιρίου Α", assetClass: "HVAC", manufacturer: "Carrier", model: "30XA", installed: "2013-07-22", capitalCost: 190000, lifeYears: 18, replacementYear: 2031, replacementCostEst: 270000, criticality: 1, condition: "C", system: "HVAC" },
  { key: "lgh-lv-board", orgUnitId: LGH, areaCode: "PLT-01", nameEl: "Κεντρικός πίνακας χαμηλής τάσης κτιρίου Α Λεμεσού", assetClass: "ELECTRICAL", manufacturer: "Schneider Electric", model: "Okken", installed: "2005-03-10", capitalCost: 158000, lifeYears: 30, replacementYear: 2035, replacementCostEst: 320000, criticality: 1, condition: "C", system: "ELECTRICAL" },
  { key: "lgh-generator", orgUnitId: LGH, areaCode: null, nameEl: "Ηλεκτροπαραγωγό ζεύγος Η/Ζ-Λε1", assetClass: "ELECTRICAL", manufacturer: "Caterpillar", model: "C18", installed: "2015-02-19", capitalCost: 238000, lifeYears: 25, replacementYear: 2036, replacementCostEst: 372000, criticality: 1, condition: "B", system: "ELECTRICAL" },
  { key: "lgh-ups", orgUnitId: LGH, areaCode: "PLT-01", nameEl: "Σύστημα αδιάλειπτης παροχής UPS-Λε1", assetClass: "ELECTRICAL", manufacturer: "Eaton", model: "93PM", installed: "2019-09-05", capitalCost: 41000, lifeYears: 12, replacementYear: 2031, replacementCostEst: 61000, criticality: 2, condition: "B", system: "ELECTRICAL" },
  { key: "lgh-fire-panel", orgUnitId: LGH, areaCode: "OFF-01", nameEl: "Κεντρικός πίνακας πυρανίχνευσης κτιρίου Α Λεμεσού", assetClass: "FIRE", manufacturer: "Siemens", model: "FC2060", installed: "2011-11-03", capitalCost: 46000, lifeYears: 15, replacementYear: 2027, replacementCostEst: 72000, criticality: 1, condition: "D", system: "FIRE" },
  { key: "lgh-mgas-manifold", orgUnitId: LGH, areaCode: "PLT-01", nameEl: "Συστοιχία ιατρικών αερίων Λεμεσού", assetClass: "MEDICAL_GAS", manufacturer: "BeaconMedaes", model: "SP-2x8", installed: "2008-04-17", capitalCost: 69000, lifeYears: 25, replacementYear: 2033, replacementCostEst: 91000, criticality: 1, condition: "C", system: "MEDICAL_GAS" },
  { key: "lgh-booster", orgUnitId: LGH, areaCode: "PLT-01", nameEl: "Πιεστικό συγκρότημα ύδρευσης Λεμεσού", assetClass: "WATER", manufacturer: "Grundfos", model: "Hydro MPC-E", installed: "2012-05-30", capitalCost: 27000, lifeYears: 15, replacementYear: 2027, replacementCostEst: 38000, criticality: 2, condition: "D", system: "WATER" },
  { key: "lgh-server-rack", orgUnitId: LGH, areaCode: "OFF-01", nameEl: "Ικρίωμα δικτύου κτιρίου Α Λεμεσού", assetClass: "IT", manufacturer: "Cisco", model: "Catalyst 9300", installed: "2020-01-27", capitalCost: 15500, lifeYears: 8, replacementYear: 2028, replacementCostEst: 23000, criticality: 3, condition: "B", system: "IT" },
  // -------------------------------------------------------------- Πάφος --
  { key: "paf-ahu-1", orgUnitId: PAF, areaCode: "PLT-01", nameEl: "Κλιματιστική μονάδα ΚΚΜ-Π1", assetClass: "HVAC", manufacturer: "Systemair", model: "DV-60", installed: "2009-04-08", capitalCost: 61000, lifeYears: 20, replacementYear: 2029, replacementCostEst: 98000, criticality: 2, condition: "D", system: "HVAC" },
  { key: "paf-chiller-1", orgUnitId: PAF, areaCode: null, nameEl: "Ψύκτης Ψ-Π1, δώμα χειρουργικού τομέα", assetClass: "HVAC", manufacturer: "Daikin", model: "EWAD-TZ", installed: "2016-06-13", capitalCost: 168000, lifeYears: 18, replacementYear: 2034, replacementCostEst: 244000, criticality: 1, condition: "B", system: "HVAC" },
  { key: "paf-boiler-1", orgUnitId: PAF, areaCode: "PLT-01", nameEl: "Λέβητας θέρμανσης Λ-Π1", assetClass: "HVAC", manufacturer: "Viessmann", model: "Vitoplex 200", installed: "1999-10-21", capitalCost: 52000, lifeYears: 25, replacementYear: 2027, replacementCostEst: 96000, criticality: 2, condition: "E", system: "HVAC" },
  { key: "paf-lv-board", orgUnitId: PAF, areaCode: "PLT-01", nameEl: "Κεντρικός πίνακας χαμηλής τάσης Πάφου", assetClass: "ELECTRICAL", manufacturer: "ABB", model: "MNS", installed: "2009-02-25", capitalCost: 131000, lifeYears: 30, replacementYear: 2037, replacementCostEst: 268000, criticality: 1, condition: "C", system: "ELECTRICAL" },
  { key: "paf-generator", orgUnitId: PAF, areaCode: null, nameEl: "Ηλεκτροπαραγωγό ζεύγος Η/Ζ-Π1", assetClass: "ELECTRICAL", manufacturer: "Perkins", model: "2506C", installed: "2014-08-12", capitalCost: 142000, lifeYears: 25, replacementYear: 2037, replacementCostEst: 255000, criticality: 1, condition: "B", system: "ELECTRICAL" },
  { key: "paf-ups", orgUnitId: PAF, areaCode: "PLT-01", nameEl: "Σύστημα αδιάλειπτης παροχής UPS-Π1", assetClass: "ELECTRICAL", manufacturer: "Socomec", model: "Masterys", installed: "2017-03-17", capitalCost: 34000, lifeYears: 12, replacementYear: 2029, replacementCostEst: 52000, criticality: 2, condition: "C", system: "ELECTRICAL" },
  { key: "paf-fire-panel", orgUnitId: PAF, areaCode: "OFF-01", nameEl: "Κεντρικός πίνακας πυρανίχνευσης Πάφου", assetClass: "FIRE", manufacturer: "Honeywell", model: "Morley ZX", installed: "2013-01-30", capitalCost: 39000, lifeYears: 15, replacementYear: 2028, replacementCostEst: 64000, criticality: 1, condition: "C", system: "FIRE" },
  { key: "paf-sprinkler-pump", orgUnitId: PAF, areaCode: "PLT-01", nameEl: "Αντλητικό συγκρότημα πυρόσβεσης Πάφου", assetClass: "FIRE", manufacturer: "Grundfos", model: "NK", installed: "2010-09-09", capitalCost: 33000, lifeYears: 20, replacementYear: 2030, replacementCostEst: 52000, criticality: 2, condition: "C", system: "FIRE" },
  { key: "paf-booster", orgUnitId: PAF, areaCode: "PLT-01", nameEl: "Πιεστικό συγκρότημα ύδρευσης Πάφου", assetClass: "WATER", manufacturer: "Lowara", model: "e-HM", installed: "2018-12-04", capitalCost: 21000, lifeYears: 15, replacementYear: 2033, replacementCostEst: 33000, criticality: 2, condition: "B", system: "WATER" },
  { key: "paf-server-rack", orgUnitId: PAF, areaCode: "OFF-01", nameEl: "Ικρίωμα δικτύου Πάφου", assetClass: "IT", manufacturer: "HPE Aruba", model: "6300", installed: "2021-05-18", capitalCost: 14200, lifeYears: 8, replacementYear: 2029, replacementCostEst: 21000, criticality: 3, condition: "A", system: "IT" },
  // --------------------------------------------------------- Αμμόχωστος --
  { key: "fam-ahu-1", orgUnitId: FAM, areaCode: "PLT-01", nameEl: "Κλιματιστική μονάδα ΚΚΜ-Α1", assetClass: "HVAC", manufacturer: "Trane", model: "CLCP", installed: "2007-05-22", capitalCost: 66000, lifeYears: 20, replacementYear: 2027, replacementCostEst: 108000, criticality: 2, condition: "E", system: "HVAC" },
  { key: "fam-chiller-1", orgUnitId: FAM, areaCode: null, nameEl: "Ψύκτης Ψ-Α1, δώμα κτιρίου Α", assetClass: "HVAC", manufacturer: "Carrier", model: "30RB", installed: "2011-07-04", capitalCost: 152000, lifeYears: 18, replacementYear: 2029, replacementCostEst: 232000, criticality: 1, condition: "D", system: "HVAC" },
  { key: "fam-lv-board", orgUnitId: FAM, areaCode: "PLT-01", nameEl: "Κεντρικός πίνακας χαμηλής τάσης Αμμοχώστου", assetClass: "ELECTRICAL", manufacturer: "Siemens", model: "Sivacon", installed: "2007-10-15", capitalCost: 118000, lifeYears: 30, replacementYear: 2037, replacementCostEst: 250000, criticality: 1, condition: "C", system: "ELECTRICAL" },
  { key: "fam-generator", orgUnitId: FAM, areaCode: null, nameEl: "Ηλεκτροπαραγωγό ζεύγος Η/Ζ-Α1", assetClass: "ELECTRICAL", manufacturer: "Cummins", model: "C550D5", installed: "2012-03-28", capitalCost: 126000, lifeYears: 25, replacementYear: 2037, replacementCostEst: 235000, criticality: 1, condition: "C", system: "ELECTRICAL" },
  { key: "fam-ups", orgUnitId: FAM, areaCode: "PLT-01", nameEl: "Σύστημα αδιάλειπτης παροχής UPS-Α1", assetClass: "ELECTRICAL", manufacturer: "APC", model: "Symmetra", installed: "2016-11-09", capitalCost: 28000, lifeYears: 12, replacementYear: 2028, replacementCostEst: 47000, criticality: 2, condition: "C", system: "ELECTRICAL" },
  { key: "fam-fire-panel", orgUnitId: FAM, areaCode: "OFF-01", nameEl: "Κεντρικός πίνακας πυρανίχνευσης Αμμοχώστου", assetClass: "FIRE", manufacturer: "Notifier", model: "NFS2-3030", installed: "2009-06-02", capitalCost: 36000, lifeYears: 15, replacementYear: 2027, replacementCostEst: 59000, criticality: 1, condition: "D", system: "FIRE" },
  { key: "fam-mgas-manifold", orgUnitId: FAM, areaCode: "PLT-01", nameEl: "Συστοιχία ιατρικών αερίων Αμμοχώστου", assetClass: "MEDICAL_GAS", manufacturer: "Air Liquide", model: "Alpha", installed: "2010-02-16", capitalCost: 58000, lifeYears: 25, replacementYear: 2034, replacementCostEst: 82000, criticality: 1, condition: "C", system: "MEDICAL_GAS" },
  { key: "fam-booster", orgUnitId: FAM, areaCode: "PLT-01", nameEl: "Πιεστικό συγκρότημα ύδρευσης Αμμοχώστου", assetClass: "WATER", manufacturer: "Grundfos", model: "Hydro MPC", installed: "2015-04-21", capitalCost: 23000, lifeYears: 15, replacementYear: 2030, replacementCostEst: 34000, criticality: 2, condition: "C", system: "WATER" },
  { key: "fam-server-rack", orgUnitId: FAM, areaCode: "OFF-01", nameEl: "Ικρίωμα δικτύου Αμμοχώστου", assetClass: "IT", manufacturer: "Cisco", model: "Catalyst 2960X", installed: "2018-02-12", capitalCost: 12800, lifeYears: 8, replacementYear: 2027, replacementCostEst: 19500, criticality: 3, condition: "D", system: "IT" },
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
  // Limassol: eight lines, two overdue (the booster, the air handler).
  { unit: "limassol-general", code: "1.2.1", assetKey: "lgh-ahu-1", titleEl: "Τριμηνιαία συντήρηση ΚΚΜ-Λε1", frequency: "QUARTERLY", dueInDays: -20, checklistEl: "Έλεγχος και αλλαγή φίλτρων\nΈλεγχος ιμάντων και ρουλεμάν\nΚαθαρισμός στοιχείων\nΈλεγχος αποχέτευσης συμπυκνωμάτων" },
  { unit: "limassol-general", code: "1.1.2", assetKey: "lgh-booster", titleEl: "Μηνιαία συντήρηση πιεστικού ύδρευσης", frequency: "MONTHLY", dueInDays: -4, checklistEl: "Έλεγχος πιεστικού δοχείου\nΈλεγχος στυπιοθλιπτών\nΚαταγραφή πίεσης" },
  { unit: "limassol-general", code: "1.2.1", assetKey: "lgh-chiller-1", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-Λε1", frequency: "MONTHLY", dueInDays: 4, checklistEl: "Καταγραφή πιέσεων και θερμοκρασιών\nΈλεγχος διαρροών ψυκτικού\nΈλεγχος ελαίου συμπιεστών" },
  { unit: "limassol-general", code: "2.2.11", assetKey: "lgh-fire-panel", titleEl: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", frequency: "QUARTERLY", dueInDays: 12, checklistEl: "Δοκιμή ανιχνευτών ανά ζώνη\nΈλεγχος σειρήνων\nΈλεγχος εφεδρικής τροφοδοσίας" },
  { unit: "limassol-general", code: "2.2.5", assetKey: "lgh-generator", titleEl: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Λε1", frequency: "MONTHLY", dueInDays: 27, checklistEl: "Δοκιμή εκκίνησης υπό φορτίο\nΈλεγχος στάθμης καυσίμου\nΈλεγχος συσσωρευτών" },
  { unit: "limassol-general", code: "1.2.3", assetKey: "lgh-mgas-manifold", titleEl: "Τριμηνιαία συντήρηση συστοιχίας ιατρικών αερίων", frequency: "QUARTERLY", dueInDays: 38, checklistEl: "Έλεγχος πιέσεων γραμμών\nΈλεγχος συναγερμών\nΈλεγχος βαλβίδων αποκοπής" },
  { unit: "limassol-general", code: "2.2.6", assetKey: "lgh-ups", titleEl: "Εξαμηνιαία συντήρηση UPS-Λε1", frequency: "SEMIANNUAL", dueInDays: 63, checklistEl: "Δοκιμή αυτονομίας συσσωρευτών\nΈλεγχος ανεμιστήρων\nΚαταγραφή συναγερμών" },
  { unit: "limassol-general", code: "2.2.16", assetKey: "lgh-server-rack", titleEl: "Ετήσιος έλεγχος δομημένης καλωδίωσης κτιρίου Α", frequency: "ANNUAL", dueInDays: 88, checklistEl: "Έλεγχος σημάνσεων\nΔοκιμή δειγματοληπτικών απολήξεων" },
  // Paphos: seven lines, the boiler and the fire pump overdue.
  { unit: "paphos-general", code: "1.2.1", assetKey: "paf-boiler-1", titleEl: "Εξαμηνιαία συντήρηση λέβητα θέρμανσης Λ-Π1", frequency: "SEMIANNUAL", dueInDays: -9, checklistEl: "Καθαρισμός καυστήρα και θαλάμου καύσης\nΈλεγχος ασφαλιστικών βαλβίδων\nΜέτρηση καυσαερίων" },
  { unit: "paphos-general", code: "1.2.4", assetKey: "paf-sprinkler-pump", titleEl: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης", frequency: "MONTHLY", dueInDays: -2, checklistEl: "Δοκιμή εκκίνησης αντλιών\nΈλεγχος πιεστικού δοχείου\nΚαταγραφή πίεσης δικτύου" },
  { unit: "paphos-general", code: "1.2.1", assetKey: "paf-chiller-1", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-Π1", frequency: "MONTHLY", dueInDays: 9, checklistEl: "Καταγραφή πιέσεων και θερμοκρασιών\nΈλεγχος διαρροών ψυκτικού\nΈλεγχος ελαίου συμπιεστών" },
  { unit: "paphos-general", code: "2.2.5", assetKey: "paf-generator", titleEl: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Π1", frequency: "MONTHLY", dueInDays: 14, checklistEl: "Δοκιμή εκκίνησης υπό φορτίο\nΈλεγχος στάθμης καυσίμου\nΈλεγχος συσσωρευτών" },
  { unit: "paphos-general", code: "1.2.1", assetKey: "paf-ahu-1", titleEl: "Τριμηνιαία συντήρηση ΚΚΜ-Π1", frequency: "QUARTERLY", dueInDays: 21, checklistEl: "Έλεγχος και αλλαγή φίλτρων\nΈλεγχος ιμάντων και ρουλεμάν\nΚαθαρισμός στοιχείων" },
  { unit: "paphos-general", code: "2.2.11", assetKey: "paf-fire-panel", titleEl: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", frequency: "QUARTERLY", dueInDays: 45, checklistEl: "Δοκιμή ανιχνευτών ανά ζώνη\nΈλεγχος σειρήνων\nΈλεγχος εφεδρικής τροφοδοσίας" },
  { unit: "paphos-general", code: "2.2.6", assetKey: "paf-ups", titleEl: "Εξαμηνιαία συντήρηση UPS-Π1", frequency: "SEMIANNUAL", dueInDays: 72, checklistEl: "Δοκιμή αυτονομίας συσσωρευτών\nΈλεγχος ανεμιστήρων\nΚαταγραφή συναγερμών" },
  // Famagusta: seven lines, the chiller and the fire panel overdue.
  { unit: "famagusta-general", code: "2.2.11", assetKey: "fam-fire-panel", titleEl: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", frequency: "QUARTERLY", dueInDays: -17, checklistEl: "Δοκιμή ανιχνευτών ανά ζώνη\nΈλεγχος σειρήνων\nΈλεγχος εφεδρικής τροφοδοσίας" },
  { unit: "famagusta-general", code: "1.2.1", assetKey: "fam-chiller-1", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-Α1", frequency: "MONTHLY", dueInDays: -6, checklistEl: "Καταγραφή πιέσεων και θερμοκρασιών\nΈλεγχος διαρροών ψυκτικού\nΈλεγχος ελαίου συμπιεστών" },
  { unit: "famagusta-general", code: "2.2.5", assetKey: "fam-generator", titleEl: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Α1", frequency: "MONTHLY", dueInDays: 8, checklistEl: "Δοκιμή εκκίνησης υπό φορτίο\nΈλεγχος στάθμης καυσίμου\nΈλεγχος συσσωρευτών" },
  { unit: "famagusta-general", code: "1.2.1", assetKey: "fam-ahu-1", titleEl: "Τριμηνιαία συντήρηση ΚΚΜ-Α1", frequency: "QUARTERLY", dueInDays: 16, checklistEl: "Έλεγχος και αλλαγή φίλτρων\nΈλεγχος ιμάντων και ρουλεμάν\nΚαθαρισμός στοιχείων" },
  { unit: "famagusta-general", code: "1.2.3", assetKey: "fam-mgas-manifold", titleEl: "Τριμηνιαία συντήρηση συστοιχίας ιατρικών αερίων", frequency: "QUARTERLY", dueInDays: 33, checklistEl: "Έλεγχος πιέσεων γραμμών\nΈλεγχος συναγερμών\nΈλεγχος βαλβίδων αποκοπής" },
  { unit: "famagusta-general", code: "2.2.1", assetKey: "fam-lv-board", titleEl: "Εξαμηνιαία συντήρηση κεντρικού πίνακα χαμηλής τάσης", frequency: "SEMIANNUAL", dueInDays: 58, checklistEl: "Θερμογράφηση\nΣύσφιξη ακροδεκτών\nΈλεγχος διακοπτών" },
  { unit: "famagusta-general", code: "2.2.16", assetKey: "fam-server-rack", titleEl: "Ετήσιος έλεγχος δομημένης καλωδίωσης", frequency: "ANNUAL", dueInDays: 84, checklistEl: "Έλεγχος σημάνσεων\nΔοκιμή δειγματοληπτικών απολήξεων" },
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
  /** What was reported when the call was raised; the order's own text. */
  descriptionEl?: string;
  /** What was changed or fitted, for the completed ones. */
  partsNoteEl?: string;
  /** The reason, on a cancelled or paused order. */
  noteEl?: string;
  /** Free notes on the order, as [hours after the call, text]. */
  notes?: [number, string][];
  by: string;
  assignedToEl?: string;
}

const D = 24;

/** Who grants an extension: the estates head where the unit has one, else the admin. */
const COORDINATOR: Record<string, string> = {
  "nicosia-general": "dev-estates-nicosia",
  "larnaca-general": "dev-estates-larnaca",
};

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

  // ----------------------------------------------- Nicosia, the earlier months --
  // Six months of history, so the scorecard's previous quarters have figures:
  // April to June is the second quarter, July to September the third. Nothing
  // reaches back before the middle of April.

  // Three on the network rack inside twelve months: the repeat count and the
  // third auto-drafted backlog item (R36).
  { unit: "nicosia-general", titleEl: "Βλάβη μεταγωγέα δικτύου στο ικρίωμα κτιρίου Α", descriptionEl: "Ο μεταγωγέας του ικριώματος δεν τροφοδοτεί τις θύρες του πρώτου ορόφου. Η Τεχνική Υπηρεσία ζήτησε επιτόπια παρέμβαση.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.16", assetKey: "ngh-server-rack", calledHoursAgo: 150 * D, respondedH: 0.4, restoredH: 6, completedH: 30, reportH: 30, codes: ["NO_OUTPUT", "WEAR", "REPLACE_PART"], costActual: 480, partsNoteEl: "Αντικαταστάθηκε ο μεταγωγέας με αποθεματικό του αναδόχου.", by: "dev-technician-nicosia", assignedToEl: "Σ. Πετρίδης" },
  { unit: "nicosia-general", titleEl: "Υπερθέρμανση στο ικρίωμα δικτύου κτιρίου Α", descriptionEl: "Συναγερμός θερμοκρασίας στο ικρίωμα. Ο κλιματισμός του χώρου λειτουργούσε με μειωμένη απόδοση.", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "2.2.16", assetKey: "ngh-server-rack", calledHoursAgo: 105 * D, respondedH: 0.5, restoredH: 5, completedH: 28, reportH: 28, codes: ["DEGRADED", "ENVIRONMENT", "ADJUST"], costActual: 150, by: "dev-engineer-nicosia", assignedToEl: "Σ. Πετρίδης" },
  { unit: "nicosia-general", titleEl: "Διακοπτόμενες συνδέσεις στο ικρίωμα δικτύου κτιρίου Α", descriptionEl: "Επαναλαμβανόμενες διακοπές σύνδεσης στις θύρες του ικριώματος, με υποψία για φθαρμένα καλώδια διασύνδεσης.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "2.2.16", assetKey: "ngh-server-rack", calledHoursAgo: 64 * D, respondedH: 0.9, restoredH: 14, completedH: 52, reportH: 52, codes: ["DEGRADED", "WEAR", "REPLACE_PART"], costActual: 390, noteEl: "Αντικαταστάθηκαν τα καλώδια διασύνδεσης και σημάνθηκαν εκ νέου.", notes: [[20, "Εντοπίστηκαν φθαρμένα καλώδια διασύνδεσης· ζητήθηκαν από την αποθήκη του αναδόχου."]], by: "dev-clinical-nicosia", assignedToEl: "Α. Κυπριανού" },

  { unit: "nicosia-general", titleEl: "Θόρυβος ιμάντα στην ΚΚΜ-2", descriptionEl: "Ηχηρός θόρυβος από τον ιμάντα του ανεμιστήρα προσαγωγής της ΚΚΜ-2.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "ngh-ahu-2", calledHoursAgo: 165 * D, respondedH: 0.3, restoredH: 5, completedH: 26, reportH: 26, codes: ["NOISE_VIBRATION", "WEAR", "REPLACE_PART"], costActual: 210, by: "dev-technician-nicosia", assignedToEl: "Α. Κυπριανού" },
  { unit: "nicosia-general", titleEl: "Αποτυχία αυτόματης μετάβασης του Η/Ζ-1", descriptionEl: "Κατά τη δοκιμή απώλειας δικτύου το ηλεκτροπαραγωγό ζεύγος δεν ανέλαβε φορτίο μέσα στον προβλεπόμενο χρόνο.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.5", assetKey: "ngh-generator", calledHoursAgo: 148 * D, respondedH: 1, restoredH: 9, completedH: 40, reportH: 40, codes: ["CONTROL_FAULT", "LACK_OF_PM", "ADJUST"], costActual: 540, by: "dev-technician-nicosia", assignedToEl: "Μ. Ευαγγέλου" },
  { unit: "nicosia-general", titleEl: "Πτώση παροχής αέρα στο χειρουργείο 1", descriptionEl: "Μειωμένη παροχή αέρα στο χειρουργείο 1· βρέθηκε βουλωμένο φίλτρο στην τελική βαθμίδα.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "1.1.1", assetKey: null, areaCode: "THE-01", calledHoursAgo: 138 * D, respondedH: 0.3, restoredH: 3.5, completedH: 30, reportH: 30, codes: ["DEGRADED", "LACK_OF_PM", "CLEAN"], costActual: 120, by: "dev-clinical-nicosia", assignedToEl: "Γ. Χαραλάμπους" },
  { unit: "nicosia-general", titleEl: "Διαρροή συμπυκνωμάτων στην ΚΚΜ-1", descriptionEl: "Νερό από τη λεκάνη συμπυκνωμάτων της ΚΚΜ-1 στο δάπεδο του μηχανοστασίου.", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.2.1", assetKey: "ngh-ahu-1", calledHoursAgo: 130 * D, respondedH: 0.5, restoredH: 12, completedH: 36, reportH: 36, codes: ["LEAK", "WEAR", "CLEAN"], costActual: 90, by: "dev-engineer-nicosia", assignedToEl: "Σ. Πετρίδης" },
  { unit: "nicosia-general", titleEl: "Διακοπή ρεύματος στον τοπικό πίνακα της ΜΕΘ", descriptionEl: "Έπεσε η γενική ασφάλεια του τοπικού πίνακα της Μονάδας Εντατικής Θεραπείας· επαναφέρθηκε από την ομάδα του αναδόχου.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "2.1.3", assetKey: null, areaCode: "ICU-01", calledHoursAgo: 125 * D, respondedH: 0.2, restoredH: 1.1, completedH: 20, reportH: 20, codes: ["ELECTRICAL_FAULT", "POWER_SUPPLY", "RESET"], costActual: 0, by: "dev-clinical-nicosia", assignedToEl: "Γ. Χαραλάμπους" },
  { unit: "nicosia-general", titleEl: "Χαμηλή πίεση στο δίκτυο πυρόσβεσης", descriptionEl: "Η πίεση του δικτύου πυρόσβεσης έπεφτε κάτω από το όριο συναγερμού μετά από κάθε εκκίνηση του αντλητικού.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.4", assetKey: "ngh-sprinkler-pump", calledHoursAgo: 118 * D, respondedH: 0.4, restoredH: 14, completedH: 40, reportH: 40, codes: ["DEGRADED", "WEAR", "REPAIR"], costActual: 360, by: "dev-technician-nicosia", assignedToEl: "Γ. Χαραλάμπους" },
  { unit: "nicosia-general", titleEl: "Συναγερμός χαμηλής πίεσης στη συστοιχία ιατρικών αερίων", descriptionEl: "Συναγερμός στη συστοιχία μετά από παράδοση φιαλών· η πίεση επανήλθε μετά την αλλαγή της γραμμής.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "1.1.3", assetKey: "ngh-mgas-manifold", calledHoursAgo: 102 * D, respondedH: 0.3, restoredH: 1.6, completedH: 22, reportH: 22, codes: ["ALARM", "EXTERNAL", "RESET"], costActual: 0, by: "dev-clinical-nicosia", assignedToEl: "Μ. Ευαγγέλου" },
  { unit: "nicosia-general", titleEl: "Σφάλμα αισθητήρα θερμοκρασίας στο BMS", descriptionEl: "Εσφαλμένες ενδείξεις θερμοκρασίας από έναν αισθητήρα στα γραφεία των Τεχνικών Υπηρεσιών.", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.3.3", assetKey: null, areaCode: "OFF-01", calledHoursAgo: 95 * D, respondedH: 0.6, restoredH: 30, completedH: 60, reportH: 60, codes: ["CONTROL_FAULT", "WEAR", "REPLACE_PART"], costActual: 210, by: "dev-engineer-nicosia", assignedToEl: "Α. Κυπριανού" },
  { unit: "nicosia-general", titleEl: "Ειδοποίηση συσσωρευτών στο UPS-1", descriptionEl: "Το UPS-1 ανέφερε μειωμένη αυτονομία συσσωρευτών κατά την περιοδική δοκιμή.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.6", assetKey: "ngh-ups", calledHoursAgo: 90 * D, respondedH: 0.3, restoredH: 4, completedH: 24, reportH: 24, codes: ["ALARM", "WEAR", "REPLACE_PART"], costActual: 780, partsNoteEl: "Αντικαταστάθηκε η σειρά συσσωρευτών.", by: "dev-technician-nicosia", assignedToEl: "Σ. Πετρίδης" },
  { unit: "nicosia-general", titleEl: "Ετήσιος θερμογραφικός έλεγχος πινάκων χαμηλής τάσης", descriptionEl: "Θερμογράφηση των πινάκων χαμηλής τάσης του κτιρίου Α, όπως απαιτεί η νομοθεσία.", kind: "STATUTORY", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "2.2.1", assetKey: "ngh-lv-board", calledHoursAgo: 160 * D, respondedH: 0.3, restoredH: 20, completedH: 30, reportH: 30, costActual: 860, by: "dev-engineer-nicosia", assignedToEl: "Γ. Χαραλάμπους" },
  { unit: "nicosia-general", titleEl: "Ετήσιος έλεγχος αντικεραυνικής προστασίας", descriptionEl: "Μέτρηση αντιστάσεων γείωσης και έλεγχος των καταλήψεων του κτιρίου Α.", kind: "STATUTORY", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "2.3.5", assetKey: null, areaCode: "PLT-01", calledHoursAgo: 88 * D, respondedH: 0.3, restoredH: 24, completedH: 36, reportH: 36, costActual: 640, by: "dev-estates-nicosia", assignedToEl: "Μ. Ευαγγέλου" },

  { unit: "nicosia-general", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-1 — Ιούλιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "ngh-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-1", pmDueDaysAgo: 82, completedH: -12, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-1 — Ιούνιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "ngh-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-1", pmDueDaysAgo: 112, completedH: 36, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-1 — Μάιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "ngh-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-1", pmDueDaysAgo: 142, completedH: -20, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία δοκιμή Η/Ζ-1 — Ιούλιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "ngh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-1", pmDueDaysAgo: 93, completedH: -6, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία δοκιμή Η/Ζ-1 — Ιούνιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "ngh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-1", pmDueDaysAgo: 123, completedH: 2 * D, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Μηνιαία δοκιμή Η/Ζ-1 — Μάιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "ngh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-1", pmDueDaysAgo: 153, completedH: -10, by: "dev-estates-nicosia" },
  { unit: "nicosia-general", titleEl: "Τριμηνιαίος έλεγχος πυρανίχνευσης — Απρίλιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.11", assetKey: "ngh-fire-panel", scheduleTitle: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", pmDueDaysAgo: 168, completedH: -40, by: "dev-estates-nicosia" },

  // ------------------------------------------------------------- Limassol --
  // Agreement Α.Ο 18/25 with Ιωνάς. Three on the booster inside twelve
  // months, so the unit has its auto-drafted replacement too. Nobody here has
  // an account yet: the admin raises and works every order.
  { unit: LGH, titleEl: "Διαρροή από τη βάση του πιεστικού ύδρευσης", descriptionEl: "Εμφανής διαρροή νερού στη βάση του πιεστικού συγκροτήματος του μηχανοστασίου. Το προσωπικό του αναδόχου απομόνωσε τη γραμμή.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.1.2", assetKey: "lgh-booster", calledHoursAgo: 100 * D, respondedH: 0.3, restoredH: 1.4, completedH: 18, reportH: 18, codes: ["LEAK", "WEAR", "REPLACE_PART"], costActual: 1450, partsNoteEl: "Αντικαταστάθηκε ο μηχανικός στυπιοθλίπτης της αντλίας Α.", by: "dev-admin", assignedToEl: "Π. Σάββα" },
  { unit: LGH, titleEl: "Πτώση πίεσης νερού στον δεύτερο όροφο", descriptionEl: "Χαμηλή πίεση στο δίκτυο ύδρευσης του κτιρίου Α· το πιεστικό δεν ξεκινούσε.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "1.1.2", assetKey: "lgh-booster", calledHoursAgo: 62 * D, respondedH: 0.7, restoredH: 3.5, completedH: 30, reportH: 30, codes: ["NO_OUTPUT", "POWER_SUPPLY", "RESET"], costActual: 320, noteEl: "Επαναφορά του θερμικού προστασίας και έλεγχος της τροφοδοσίας.", by: "dev-admin", assignedToEl: "Κ. Δημητρίου" },
  { unit: LGH, titleEl: "Θόρυβος από τον κινητήρα του πιεστικού", descriptionEl: "Μεταλλικός θόρυβος και κραδασμοί από τον κινητήρα της αντλίας Β.", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.1.2", assetKey: "lgh-booster", calledHoursAgo: 21 * D, respondedH: 0.3, restoredH: 1.6, completedH: 22, reportH: 22, codes: ["NOISE_VIBRATION", "WEAR", "REPLACE_PART"], costActual: 980, partsNoteEl: "Αντικαταστάθηκαν τα ρουλεμάν του κινητήρα.", by: "dev-admin", assignedToEl: "Π. Σάββα" },
  { unit: LGH, titleEl: "Βλάβη βαλβίδας εκτόνωσης στον ψύκτη Ψ-Λε1", descriptionEl: "Ο ψύκτης λειτουργούσε με μειωμένη ψυκτική ισχύ λόγω βλάβης στη βαλβίδα εκτόνωσης του κυκλώματος 2.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "lgh-chiller-1", calledHoursAgo: 40 * D, respondedH: 0.25, restoredH: 4 * D, completedH: 6 * D, reportH: 40, extensionDays: 5, extensionReasonEl: "Παραγγελία βαλβίδας εκτόνωσης από τον κατασκευαστή· ο χρόνος παράδοσης ξεπερνά την προθεσμία αποκατάστασης.", codes: ["DEGRADED", "WEAR", "REPLACE_PART"], costActual: 2900, notes: [[5, "Η βαλβίδα παραγγέλθηκε από τον κατασκευαστή· ενημερώθηκε η Τεχνική Υπηρεσία."]], by: "dev-admin", assignedToEl: "Ε. Νικολάου" },
  { unit: LGH, titleEl: "Αποτυχία εκκίνησης του Η/Ζ-Λε1 κατά τη δοκιμή", descriptionEl: "Το ηλεκτροπαραγωγό ζεύγος δεν εκκινούσε κατά τη μηνιαία δοκιμή· χαμηλή τάση συσσωρευτών εκκίνησης.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.5", assetKey: "lgh-generator", calledHoursAgo: 33 * D, respondedH: 0.4, restoredH: 5, completedH: 52, reportH: 52, codes: ["NO_OUTPUT", "LACK_OF_PM", "REPLACE_PART"], costActual: 780, partsNoteEl: "Αντικαταστάθηκαν οι δύο συσσωρευτές εκκίνησης.", by: "dev-admin", assignedToEl: "Ε. Νικολάου" },
  { unit: LGH, titleEl: "Διακοπή ρεύματος στον τοπικό πίνακα της ΜΕΘ", descriptionEl: "Έπεσε η γενική ασφάλεια του τοπικού πίνακα της Μονάδας Εντατικής Θεραπείας λόγω διακοπής από το δίκτυο.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "2.1.3", assetKey: null, areaCode: "ICU-01", calledHoursAgo: 14 * D, respondedH: 0.2, restoredH: 1.2, completedH: 20, reportH: 20, codes: ["ELECTRICAL_FAULT", "EXTERNAL", "RESET"], costActual: 0, by: "dev-admin", assignedToEl: "Κ. Δημητρίου" },
  { unit: LGH, titleEl: "Υψηλή θερμοκρασία στο χειρουργείο 1", descriptionEl: "Η θερμοκρασία του χειρουργείου 1 ανέβηκε πάνω από το όριο· η ΚΚΜ-Λε1 μείωσε την παροχή ψυχρού νερού.", kind: "CORRECTIVE", status: "RESTORED", source: "NURSING", code: "1.1.1", assetKey: "lgh-ahu-1", calledHoursAgo: 7, respondedH: 0.3, restoredH: 1.8, by: "dev-admin", assignedToEl: "Κ. Δημητρίου" },
  { unit: LGH, titleEl: "Σφάλμα βρόχου 2 στον πίνακα πυρανίχνευσης", descriptionEl: "Ο πίνακας πυρανίχνευσης δείχνει σφάλμα βρόχου 2 στον πρώτο όροφο.", kind: "CORRECTIVE", status: "IN_PROGRESS", source: "TECHNICAL_SERVICES", code: "2.2.11", assetKey: "lgh-fire-panel", calledHoursAgo: 6, respondedH: 0.4, by: "dev-admin", assignedToEl: "Ε. Νικολάου" },
  { unit: LGH, titleEl: "Διαρροή στη βαλβίδα αποκοπής του δικτύου ιατρικών αερίων", descriptionEl: "Μικρή διαρροή στη βαλβίδα αποκοπής της γραμμής οξυγόνου στο μηχανοστάσιο.", kind: "CORRECTIVE", status: "PAUSED", source: "VENDOR_ONSITE", code: "1.2.3", assetKey: "lgh-mgas-manifold", calledHoursAgo: 30, respondedH: 0.5, noteEl: "Αναμονή ανταλλακτικού βαλβίδας αποκοπής.", by: "dev-admin", assignedToEl: "Π. Σάββα" },
  { unit: LGH, titleEl: "Συναγερμός χαμηλής αυτονομίας στο UPS-Λε1", descriptionEl: "Το UPS-Λε1 δείχνει συναγερμό χαμηλής αυτονομίας συσσωρευτών.", kind: "CORRECTIVE", status: "ACKNOWLEDGED", source: "NURSING", code: "2.2.6", assetKey: "lgh-ups", calledHoursAgo: 2, respondedH: 0.4, by: "dev-admin", assignedToEl: "Ε. Νικολάου" },
  { unit: LGH, titleEl: "Ανεπαρκής ψύξη στον θάλαμο Γ1", descriptionEl: "Ο θάλαμος Γ1 δεν δροσίζεται· η κλήση δεν έχει απαντηθεί από τον ανάδοχο.", kind: "CORRECTIVE", status: "OPEN", source: "NURSING", code: "1.2.1", assetKey: null, areaCode: "WRD-01", calledHoursAgo: 9, escalated: true, by: "dev-admin" },
  { unit: LGH, titleEl: "Μη διαθέσιμο δίκτυο στα γραφεία Τεχνικών Υπηρεσιών", descriptionEl: "Καμία σύνδεση δικτύου στα γραφεία των Τεχνικών Υπηρεσιών.", kind: "CORRECTIVE", status: "OPEN", source: "TECHNICAL_SERVICES", code: "2.2.16", assetKey: "lgh-server-rack", calledHoursAgo: 0.4, by: "dev-admin" },
  { unit: LGH, titleEl: "Διπλή κλήση για τον πίνακα πυρανίχνευσης", kind: "CORRECTIVE", status: "CANCELLED", source: "NURSING", code: "2.2.11", assetKey: "lgh-fire-panel", calledHoursAgo: 18 * D, cancelledH: 0.3, noteEl: "Διπλή καταχώριση της ίδιας κλήσης.", by: "dev-admin" },
  { unit: LGH, titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-Λε1 — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "lgh-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-Λε1", pmDueDaysAgo: 26, completedH: -5, by: "dev-admin" },
  { unit: LGH, titleEl: "Μηνιαία δοκιμή Η/Ζ-Λε1 — Αύγουστος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "lgh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Λε1", pmDueDaysAgo: 58, completedH: 50, by: "dev-admin" },
  { unit: LGH, titleEl: "Μηνιαία δοκιμή Η/Ζ-Λε1 — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "lgh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Λε1", pmDueDaysAgo: 28, completedH: -8, by: "dev-admin" },
  { unit: LGH, titleEl: "Τριμηνιαίος έλεγχος πυρανίχνευσης — Ιούλιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.11", assetKey: "lgh-fire-panel", scheduleTitle: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", pmDueDaysAgo: 80, completedH: -30, by: "dev-admin" },
  { unit: LGH, titleEl: "Μηνιαία δοκιμή Η/Ζ-Λε1 — Οκτώβριος", kind: "PM", status: "IN_PROGRESS", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "lgh-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Λε1", pmDueDaysAgo: -2, by: "dev-admin" },
  { unit: LGH, titleEl: "Ετήσιος έλεγχος και πιστοποίηση φορητών πυροσβεστήρων", descriptionEl: "Ετήσια επιθεώρηση και πιστοποίηση των φορητών πυροσβεστήρων όλων των ορόφων.", kind: "STATUTORY", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.2.4", assetKey: null, areaCode: "PLT-01", calledHoursAgo: 55 * D, respondedH: 0.3, restoredH: 20, completedH: 30, reportH: 30, costActual: 840, by: "dev-admin", assignedToEl: "Κ. Δημητρίου" },
  { unit: LGH, titleEl: "Περιοδική δοκιμή δικτύου ιατρικών αερίων", descriptionEl: "Περιοδική δοκιμή στεγανότητας και ποιότητας του δικτύου ιατρικών αερίων.", kind: "STATUTORY", status: "IN_PROGRESS", source: "TECHNICAL_SERVICES", code: "1.2.3", assetKey: "lgh-mgas-manifold", calledHoursAgo: 20, respondedH: 0.3, by: "dev-admin", assignedToEl: "Π. Σάββα" },

  // -------------------------------------------------------------- Paphos --
  // Agreement Α.Ο 19/25 with Thermotec. Three on the UPS inside twelve
  // months. The boiler is the oldest machine in the register (condition E)
  // and has a funded replacement.
  { unit: PAF, titleEl: "Ένδειξη σφάλματος συσσωρευτών στο UPS-Π1", descriptionEl: "Το UPS-Π1 ανέφερε σφάλμα συσσωρευτών κατά τη δοκιμή αυτονομίας.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.6", assetKey: "paf-ups", calledHoursAgo: 95 * D, respondedH: 0.3, restoredH: 3, completedH: 26, reportH: 26, codes: ["ALARM", "WEAR", "REPLACE_PART"], costActual: 1100, partsNoteEl: "Αντικαταστάθηκε ο κλάδος συσσωρευτών Β.", by: "dev-admin", assignedToEl: "Γ. Κωνσταντίνου" },
  { unit: PAF, titleEl: "Αυτόματη μετάβαση του UPS-Π1 σε παράκαμψη", descriptionEl: "Το UPS-Π1 πέρασε μόνο του σε παράκαμψη λόγω υψηλής θερμοκρασίας στο μηχανοστάσιο.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.6", assetKey: "paf-ups", calledHoursAgo: 58 * D, respondedH: 0.5, restoredH: 6, completedH: 30, reportH: 30, codes: ["ALARM", "ENVIRONMENT", "ADJUST"], costActual: 260, noteEl: "Ρυθμίστηκε το όριο θερμοκρασίας και καθαρίστηκαν τα φίλτρα εισόδου.", by: "dev-admin", assignedToEl: "Δ. Ηλία" },
  { unit: PAF, titleEl: "Βλάβη ανεμιστήρα ψύξης του UPS-Π1", descriptionEl: "Θόρυβος και ανεπαρκής εξαγωγή αέρα από τον ανεμιστήρα ψύξης του UPS-Π1.", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "2.2.6", assetKey: "paf-ups", calledHoursAgo: 19 * D, respondedH: 0.4, restoredH: 4, completedH: 46, reportH: 46, codes: ["NOISE_VIBRATION", "WEAR", "REPLACE_PART"], costActual: 540, by: "dev-admin", assignedToEl: "Γ. Κωνσταντίνου" },
  { unit: PAF, titleEl: "Διαρροή νερού από τον λέβητα θέρμανσης Λ-Π1", descriptionEl: "Διαρροή από τη φλάντζα του εναλλάκτη του λέβητα στο μηχανοστάσιο.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "paf-boiler-1", calledHoursAgo: 75 * D, respondedH: 0.4, restoredH: 18, completedH: 40, reportH: 40, codes: ["LEAK", "WEAR", "TEMPORARY_FIX"], costActual: 650, noteEl: "Προσωρινή στεγάνωση μέχρι την αντικατάσταση του λέβητα.", by: "dev-admin", assignedToEl: "Χ. Παναγή" },
  { unit: PAF, titleEl: "Βλάβη ρυθμιστή στροφών του Η/Ζ-Π1", descriptionEl: "Το ηλεκτροπαραγωγό ζεύγος δεν κρατούσε σταθερή συχνότητα υπό φορτίο· χαλασμένος ηλεκτρονικός ρυθμιστής.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.5", assetKey: "paf-generator", calledHoursAgo: 45 * D, respondedH: 0.3, restoredH: 5 * D, completedH: 7 * D, reportH: 44, extensionDays: 5, extensionReasonEl: "Εισαγωγή ηλεκτρονικού ρυθμιστή από τον κατασκευαστή, με παραστατικό παραγγελίας.", codes: ["CONTROL_FAULT", "WEAR", "REPLACE_PART"], costActual: 3400, notes: [[30, "Το ανταλλακτικό δεν υπάρχει στην Κύπρο· εκδόθηκε παραγγελία."]], by: "dev-admin", assignedToEl: "Δ. Ηλία" },
  { unit: PAF, titleEl: "Υψηλή θερμοκρασία στο χειρουργείο 1", descriptionEl: "Η θερμοκρασία του χειρουργείου 1 ξεπέρασε το όριο· ρυθμίστηκε εκ νέου ο ελεγκτής της ΚΚΜ-Π1.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "1.1.1", assetKey: "paf-ahu-1", calledHoursAgo: 28 * D, respondedH: 0.9, restoredH: 2.6, completedH: 24, reportH: 24, codes: ["CONTROL_FAULT", "LACK_OF_PM", "ADJUST"], costActual: 0, by: "dev-admin", assignedToEl: "Χ. Παναγή" },
  { unit: PAF, titleEl: "Διαρροή ψυκτικού από τον ψύκτη Ψ-Π1", descriptionEl: "Ένδειξη χαμηλής πίεσης ψυκτικού στο κύκλωμα 1 του ψύκτη.", kind: "CORRECTIVE", status: "RESTORED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "paf-chiller-1", calledHoursAgo: 16, respondedH: 0.3, restoredH: 11, by: "dev-admin", assignedToEl: "Γ. Κωνσταντίνου" },
  { unit: PAF, titleEl: "Σφάλμα επικοινωνίας στο BMS του χειρουργικού τομέα", descriptionEl: "Ο ελεγκτής του χειρουργείου 1 δεν επικοινωνεί με το κεντρικό σύστημα BMS.", kind: "CORRECTIVE", status: "IN_PROGRESS", source: "TECHNICAL_SERVICES", code: "1.3.3", assetKey: null, areaCode: "THE-01", calledHoursAgo: 12, respondedH: 0.5, by: "dev-admin", assignedToEl: "Δ. Ηλία" },
  { unit: PAF, titleEl: "Μη εκκίνηση του αντλητικού πυρόσβεσης", descriptionEl: "Το αντλητικό δεν εκκίνησε στη δοκιμή· ο ελεγκτής εκκίνησης δεν δίνει εντολή.", kind: "CORRECTIVE", status: "PAUSED", source: "VENDOR_ONSITE", code: "1.2.4", assetKey: "paf-sprinkler-pump", calledHoursAgo: 50, respondedH: 0.4, noteEl: "Αναμονή ηλεκτρονικού ελεγκτή εκκίνησης από τον προμηθευτή.", by: "dev-admin", assignedToEl: "Χ. Παναγή" },
  { unit: PAF, titleEl: "Συναγερμός υψηλής θερμοκρασίας στο Η/Ζ-Π1", descriptionEl: "Ένδειξη υψηλής θερμοκρασίας νερού ψύξης στο ηλεκτροπαραγωγό ζεύγος.", kind: "CORRECTIVE", status: "ACKNOWLEDGED", source: "TECHNICAL_SERVICES", code: "2.2.5", assetKey: "paf-generator", calledHoursAgo: 1.5, respondedH: 0.35, by: "dev-admin", assignedToEl: "Δ. Ηλία" },
  { unit: PAF, titleEl: "Βλάβη στο πιεστικό ύδρευσης", descriptionEl: "Το πιεστικό σταμάτησε και η πίεση νερού στους ορόφους έπεσε· η κλήση δεν έχει απαντηθεί.", kind: "CORRECTIVE", status: "OPEN", source: "NURSING", code: "1.1.2", assetKey: "paf-booster", calledHoursAgo: 5, escalated: true, by: "dev-admin" },
  { unit: PAF, titleEl: "Σφάλμα ζώνης 2 στον πίνακα πυρανίχνευσης", descriptionEl: "Ο πίνακας πυρανίχνευσης δείχνει σφάλμα ζώνης 2 στο ισόγειο.", kind: "CORRECTIVE", status: "OPEN", source: "TECHNICAL_SERVICES", code: "2.2.11", assetKey: "paf-fire-panel", calledHoursAgo: 0.3, by: "dev-admin" },
  { unit: PAF, titleEl: "Κλήση για λάθος μονάδα κλιματισμού", kind: "CORRECTIVE", status: "CANCELLED", source: "NURSING", code: "1.2.1", assetKey: "paf-ahu-1", calledHoursAgo: 33 * D, cancelledH: 0.5, noteEl: "Η βλάβη αφορούσε διαφορετική μονάδα· ακυρώθηκε και καταχωρίστηκε εκ νέου.", by: "dev-admin" },
  { unit: PAF, titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-Π1 — Αύγουστος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "paf-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-Π1", pmDueDaysAgo: 50, completedH: 30, by: "dev-admin" },
  { unit: PAF, titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-Π1 — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "paf-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-Π1", pmDueDaysAgo: 20, completedH: -10, by: "dev-admin" },
  { unit: PAF, titleEl: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.4", assetKey: "paf-sprinkler-pump", scheduleTitle: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης", pmDueDaysAgo: 27, completedH: -2, by: "dev-admin" },
  { unit: PAF, titleEl: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης — Οκτώβριος", kind: "PM", status: "OPEN", source: "PM_PROGRAMME", code: "1.2.4", assetKey: "paf-sprinkler-pump", scheduleTitle: "Μηνιαία δοκιμή αντλητικού πυρόσβεσης", pmDueDaysAgo: 2, by: "dev-admin" },
  { unit: PAF, titleEl: "Εξαμηνιαία συντήρηση λέβητα θέρμανσης Λ-Π1 — Οκτώβριος", kind: "PM", status: "IN_PROGRESS", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "paf-boiler-1", scheduleTitle: "Εξαμηνιαία συντήρηση λέβητα θέρμανσης Λ-Π1", pmDueDaysAgo: 9, by: "dev-admin" },
  { unit: PAF, titleEl: "Ετήσιος έλεγχος ασφαλείας του λέβητα θέρμανσης", descriptionEl: "Ετήσιος έλεγχος ασφαλιστικών και καυσαερίων του λέβητα, όπως απαιτεί η νομοθεσία.", kind: "STATUTORY", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.2.1", assetKey: "paf-boiler-1", calledHoursAgo: 70 * D, respondedH: 0.3, restoredH: 20, completedH: 30, reportH: 30, costActual: 520, by: "dev-admin", assignedToEl: "Χ. Παναγή" },
  { unit: PAF, titleEl: "Ετήσια επιθεώρηση πυροσβεστήρων", descriptionEl: "Ετήσια επιθεώρηση και πιστοποίηση των φορητών πυροσβεστήρων του κτιρίου Α.", kind: "STATUTORY", status: "ACKNOWLEDGED", source: "TECHNICAL_SERVICES", code: "1.2.4", assetKey: null, areaCode: "OFF-01", calledHoursAgo: 20, respondedH: 0.4, by: "dev-admin", assignedToEl: "Δ. Ηλία" },

  // ----------------------------------------------------------- Famagusta --
  // Agreement Α.Ο 22/25 with Παπαέλληνας. Three on the fire panel inside
  // twelve months; the chiller compressor is the fifteen-day extension.
  { unit: FAM, titleEl: "Ψευδής συναγερμός πυρανίχνευσης στη ζώνη 3", descriptionEl: "Επαναλαμβανόμενος ψευδής συναγερμός από τους ανιχνευτές της ζώνης 3 του πρώτου ορόφου.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "2.2.11", assetKey: "fam-fire-panel", calledHoursAgo: 90 * D, respondedH: 0.3, restoredH: 4, completedH: 24, reportH: 24, codes: ["ALARM", "ENVIRONMENT", "CLEAN"], costActual: 180, by: "dev-admin", assignedToEl: "Σ. Μιχαηλίδη" },
  { unit: FAM, titleEl: "Βλάβη τροφοδοτικού του πίνακα πυρανίχνευσης", descriptionEl: "Ο πίνακας πυρανίχνευσης λειτουργούσε μόνο με την εφεδρική τροφοδοσία· χαλασμένο κεντρικό τροφοδοτικό.", kind: "CORRECTIVE", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "2.2.11", assetKey: "fam-fire-panel", calledHoursAgo: 52 * D, respondedH: 0.45, restoredH: 8, completedH: 30, reportH: 30, codes: ["ELECTRICAL_FAULT", "WEAR", "REPLACE_PART"], costActual: 690, partsNoteEl: "Αντικαταστάθηκε το τροφοδοτικό και οι δύο συσσωρευτές εφεδρείας.", by: "dev-admin", assignedToEl: "Λ. Χριστοφόρου" },
  { unit: FAM, titleEl: "Απώλεια επικοινωνίας βρόχου 1 του πίνακα πυρανίχνευσης", descriptionEl: "Ο πίνακας έχασε την επικοινωνία με τον βρόχο 1· τμήμα του ορόφου χωρίς κάλυψη ανίχνευσης.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "2.2.11", assetKey: "fam-fire-panel", calledHoursAgo: 17 * D, respondedH: 0.6, restoredH: 26, completedH: 50, reportH: 50, codes: ["CONTROL_FAULT", "WEAR", "REPAIR"], costActual: 420, noteEl: "Επισκευή καλωδίωσης βρόχου και έλεγχος όλων των ανιχνευτών του βρόχου.", by: "dev-admin", assignedToEl: "Σ. Μιχαηλίδη" },
  { unit: FAM, titleEl: "Εκτός λειτουργίας ο συμπιεστής του ψύκτη Ψ-Α1", descriptionEl: "Ο συμπιεστής του κυκλώματος 1 σταμάτησε με σφάλμα υπερέντασης· ο ψύκτης λειτουργούσε με το δεύτερο κύκλωμα.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "fam-chiller-1", calledHoursAgo: 38 * D, respondedH: 0.3, restoredH: 10 * D, completedH: 12 * D, reportH: 46, extensionDays: 15, extensionReasonEl: "Εισαγωγή συμπιεστή από τον κατασκευαστή· ισχύει η παράταση των δεκαπέντε εργάσιμων ημερών για συμπιεστές ψυκτών.", codes: ["ELECTRICAL_FAULT", "WEAR", "REPLACE_PART"], costActual: 6200, notes: [[8, "Εκδόθηκε παραγγελία συμπιεστή· εκτιμώμενη παράδοση σε οκτώ ημέρες."]], by: "dev-admin", assignedToEl: "Ν. Ιωάννου" },
  { unit: FAM, titleEl: "Υπερβολικός θόρυβος στην ΚΚΜ-Α1", descriptionEl: "Έντονος θόρυβος και κραδασμοί από τον ανεμιστήρα της ΚΚΜ-Α1.", kind: "CORRECTIVE", status: "COMPLETED", source: "VENDOR_ONSITE", code: "1.2.1", assetKey: "fam-ahu-1", calledHoursAgo: 26 * D, respondedH: 0.3, restoredH: 7, completedH: 30, reportH: 30, codes: ["NOISE_VIBRATION", "WEAR", "ADJUST"], costActual: 150, by: "dev-admin", assignedToEl: "Λ. Χριστοφόρου" },
  { unit: FAM, titleEl: "Συναγερμός χαμηλής πίεσης στη συστοιχία ιατρικών αερίων", descriptionEl: "Συναγερμός χαμηλής πίεσης στη συστοιχία μετά από παράδοση φιαλών· η πίεση επανήλθε μετά την αλλαγή της γραμμής.", kind: "CORRECTIVE", status: "COMPLETED", source: "NURSING", code: "1.1.3", assetKey: "fam-mgas-manifold", calledHoursAgo: 9 * D, respondedH: 0.4, restoredH: 1.7, completedH: 20, reportH: 20, codes: ["ALARM", "EXTERNAL", "RESET"], costActual: 0, by: "dev-admin", assignedToEl: "Ν. Ιωάννου" },
  { unit: FAM, titleEl: "Διακοπή ρεύματος στον τοπικό πίνακα του χειρουργείου 1", descriptionEl: "Έπεσε ο διακόπτης τροφοδοσίας του τοπικού πίνακα του χειρουργείου 1· επαναφέρθηκε από τον ανάδοχο.", kind: "CORRECTIVE", status: "RESTORED", source: "NURSING", code: "2.1.3", assetKey: null, areaCode: "THE-01", calledHoursAgo: 5, respondedH: 0.3, restoredH: 1.5, by: "dev-admin", assignedToEl: "Σ. Μιχαηλίδη" },
  { unit: FAM, titleEl: "Αστοχία αυτόματης μετάβασης του Η/Ζ-Α1", descriptionEl: "Στη δοκιμή απώλειας δικτύου ο διακόπτης μετάβασης δεν έδωσε εντολή στο ηλεκτροπαραγωγό ζεύγος.", kind: "CORRECTIVE", status: "IN_PROGRESS", source: "VENDOR_ONSITE", code: "2.2.5", assetKey: "fam-generator", calledHoursAgo: 4, respondedH: 0.4, by: "dev-admin", assignedToEl: "Λ. Χριστοφόρου" },
  { unit: FAM, titleEl: "Διαρροή στο πιεστικό ύδρευσης", descriptionEl: "Διαρροή από τον στυπιοθλίπτη της αντλίας του πιεστικού συγκροτήματος.", kind: "CORRECTIVE", status: "PAUSED", source: "TECHNICAL_SERVICES", code: "1.1.2", assetKey: "fam-booster", calledHoursAgo: 28, respondedH: 0.5, noteEl: "Αναμονή στυπιοθλίπτη από την αποθήκη του αναδόχου.", by: "dev-admin", assignedToEl: "Ν. Ιωάννου" },
  { unit: FAM, titleEl: "Ένδειξη σφάλματος στο UPS-Α1", descriptionEl: "Το UPS-Α1 δείχνει σφάλμα μετατροπέα.", kind: "CORRECTIVE", status: "ACKNOWLEDGED", source: "VENDOR_ONSITE", code: "2.2.6", assetKey: "fam-ups", calledHoursAgo: 2.5, respondedH: 0.4, by: "dev-admin", assignedToEl: "Σ. Μιχαηλίδη" },
  { unit: FAM, titleEl: "Ανεπαρκής ψύξη στον θάλαμο Δ1", descriptionEl: "Ο θάλαμος Δ1 δεν δροσίζεται· η κλήση δεν έχει απαντηθεί από τον ανάδοχο.", kind: "CORRECTIVE", status: "OPEN", source: "NURSING", code: "1.2.1", assetKey: null, areaCode: "WRD-01", calledHoursAgo: 8, escalated: true, by: "dev-admin" },
  { unit: FAM, titleEl: "Κλήση για διακοπή που οφειλόταν στο δίκτυο της ΑΗΚ", kind: "CORRECTIVE", status: "CANCELLED", source: "TECHNICAL_SERVICES", code: "2.2.1", assetKey: "fam-lv-board", calledHoursAgo: 12 * D, cancelledH: 0.4, noteEl: "Η διακοπή οφειλόταν στο δίκτυο της ΑΗΚ· δεν απαιτείται παρέμβαση του αναδόχου.", by: "dev-admin" },
  { unit: FAM, titleEl: "Τριμηνιαία συντήρηση ΚΚΜ-Α1 — Ιούλιος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "fam-ahu-1", scheduleTitle: "Τριμηνιαία συντήρηση ΚΚΜ-Α1", pmDueDaysAgo: 75, completedH: -20, by: "dev-admin" },
  { unit: FAM, titleEl: "Μηνιαία δοκιμή Η/Ζ-Α1 — Αύγουστος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "fam-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Α1", pmDueDaysAgo: 51, completedH: 20, by: "dev-admin" },
  { unit: FAM, titleEl: "Μηνιαία δοκιμή Η/Ζ-Α1 — Σεπτέμβριος", kind: "PM", status: "COMPLETED", source: "PM_PROGRAMME", code: "2.2.5", assetKey: "fam-generator", scheduleTitle: "Μηνιαία δοκιμή ηλεκτροπαραγωγού ζεύγους Η/Ζ-Α1", pmDueDaysAgo: 21, completedH: -8, by: "dev-admin" },
  { unit: FAM, titleEl: "Μηνιαία συντήρηση ψύκτη Ψ-Α1 — Οκτώβριος", kind: "PM", status: "OPEN", source: "PM_PROGRAMME", code: "1.2.1", assetKey: "fam-chiller-1", scheduleTitle: "Μηνιαία συντήρηση ψύκτη Ψ-Α1", pmDueDaysAgo: 6, by: "dev-admin" },
  { unit: FAM, titleEl: "Τριμηνιαίος έλεγχος πυρανίχνευσης — Οκτώβριος", kind: "PM", status: "IN_PROGRESS", source: "PM_PROGRAMME", code: "2.2.11", assetKey: "fam-fire-panel", scheduleTitle: "Τριμηνιαίος έλεγχος πίνακα πυρανίχνευσης", pmDueDaysAgo: 17, by: "dev-admin" },
  { unit: FAM, titleEl: "Ετήσιος έλεγχος του συστήματος ιατρικών αερίων", descriptionEl: "Ετήσια δοκιμή στεγανότητας και πιστοποίηση του δικτύου ιατρικών αερίων.", kind: "STATUTORY", status: "COMPLETED", source: "TECHNICAL_SERVICES", code: "1.2.3", assetKey: "fam-mgas-manifold", calledHoursAgo: 64 * D, respondedH: 0.3, restoredH: 20, completedH: 36, reportH: 36, costActual: 1250, by: "dev-admin", assignedToEl: "Ν. Ιωάννου" },
  { unit: FAM, titleEl: "Ετήσια επιθεώρηση πυροσβεστήρων", descriptionEl: "Ετήσια επιθεώρηση και πιστοποίηση των φορητών πυροσβεστήρων του κτιρίου Α.", kind: "STATUTORY", status: "ACKNOWLEDGED", source: "TECHNICAL_SERVICES", code: "1.2.4", assetKey: null, areaCode: "OFF-01", calledHoursAgo: 6, respondedH: 0.5, by: "dev-admin", assignedToEl: "Λ. Χριστοφόρου" },
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
  /** Typed items only; an auto-drafted one is raised the day after its last order. Default 30. */
  raisedDaysAgo?: number;
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
      "Το κόστος επισκευών των τελευταίων δώδεκα μηνών ξεπερνά το επιτρεπόμενο ποσοστό της εκτίμησης κόστους αντικατάστασης.",
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
  // The third auto-drafted item at Nicosia: three orders on the network rack.
  {
    unit: "nicosia-general",
    titleEl: "Αντικατάσταση: Ικρίωμα δικτύου κτιρίου Α",
    kind: "REPLACEMENT",
    riskBand: "MODERATE",
    costEstimate: null,
    assetKey: "ngh-server-rack",
    code: "2.2.16",
    status: "OPEN",
    descriptionEl: "Τρεις ή περισσότερες διορθωτικές εντολές στο ίδιο πάγιο μέσα σε δώδεκα μήνες.",
    auto: {
      reason: "THREE_CORRECTIVE_IN_12_MONTHS",
      orderTitles: [
        "Βλάβη μεταγωγέα δικτύου στο ικρίωμα κτιρίου Α",
        "Υπερθέρμανση στο ικρίωμα δικτύου κτιρίου Α",
        "Διακοπτόμενες συνδέσεις στο ικρίωμα δικτύου κτιρίου Α",
      ],
    },
    by: null,
  },
  // Limassol: the auto-drafted booster, a funded gas upgrade, one done, one open.
  {
    unit: "limassol-general",
    titleEl: "Αντικατάσταση: Πιεστικό συγκρότημα ύδρευσης Λεμεσού",
    kind: "REPLACEMENT",
    riskBand: "SIGNIFICANT",
    costEstimate: null,
    assetKey: "lgh-booster",
    code: "1.1.2",
    status: "OPEN",
    descriptionEl: "Τρεις ή περισσότερες διορθωτικές εντολές στο ίδιο πάγιο μέσα σε δώδεκα μήνες.",
    auto: {
      reason: "THREE_CORRECTIVE_IN_12_MONTHS",
      orderTitles: [
        "Διαρροή από τη βάση του πιεστικού ύδρευσης",
        "Πτώση πίεσης νερού στον δεύτερο όροφο",
        "Θόρυβος από τον κινητήρα του πιεστικού",
      ],
    },
    by: null,
  },
  {
    unit: "limassol-general",
    titleEl: "Αντικατάσταση βαλβίδων αποκοπής και αναβάθμιση συστοιχίας ιατρικών αερίων",
    kind: "UPGRADE",
    riskBand: "HIGH",
    costEstimate: 96000,
    assetKey: "lgh-mgas-manifold",
    code: "1.2.3",
    status: "FUNDED",
    descriptionEl: "Οι βαλβίδες αποκοπής της συστοιχίας διαρρέουν και δεν υπάρχουν πλέον ανταλλακτικά του κατασκευαστή.",
    projectTitle: "Αναβάθμιση δικτύου ιατρικών αερίων",
    raisedDaysAgo: 60,
    by: "dev-admin",
  },
  {
    unit: "limassol-general",
    titleEl: "Αποκατάσταση θερμομόνωσης σωληνώσεων μηχανοστασίου",
    kind: "REPAIR",
    riskBand: "LOW",
    costEstimate: 9400,
    assetKey: null,
    code: "1.2.1",
    status: "DONE",
    descriptionEl: "Τοπική αντικατάσταση φθαρμένης θερμομόνωσης στις σωληνώσεις ψυχρού νερού.",
    closedDaysAgo: 35,
    raisedDaysAgo: 90,
    by: "dev-admin",
  },
  {
    unit: "limassol-general",
    titleEl: "Επισκευή του δικτύου αποχέτευσης στο μηχανοστάσιο",
    kind: "REPAIR",
    riskBand: "MODERATE",
    costEstimate: 15500,
    assetKey: null,
    code: "1.2.7",
    status: "OPEN",
    descriptionEl: "Υποχώρηση και μερική απόφραξη του οριζόντιου συλλέκτη κάτω από το δάπεδο του μηχανοστασίου.",
    raisedDaysAgo: 14,
    by: "dev-admin",
  },
  // Paphos: the auto-drafted UPS, the boiler funded by its project, one done, one open.
  {
    unit: "paphos-general",
    titleEl: "Αντικατάσταση: Σύστημα αδιάλειπτης παροχής UPS-Π1",
    kind: "REPLACEMENT",
    riskBand: "SIGNIFICANT",
    costEstimate: null,
    assetKey: "paf-ups",
    code: "2.2.6",
    status: "OPEN",
    descriptionEl: "Τρεις ή περισσότερες διορθωτικές εντολές στο ίδιο πάγιο μέσα σε δώδεκα μήνες.",
    auto: {
      reason: "THREE_CORRECTIVE_IN_12_MONTHS",
      orderTitles: [
        "Ένδειξη σφάλματος συσσωρευτών στο UPS-Π1",
        "Αυτόματη μετάβαση του UPS-Π1 σε παράκαμψη",
        "Βλάβη ανεμιστήρα ψύξης του UPS-Π1",
      ],
    },
    by: null,
  },
  {
    unit: "paphos-general",
    titleEl: "Αντικατάσταση λέβητα θέρμανσης Λ-Π1",
    kind: "REPLACEMENT",
    riskBand: "HIGH",
    costEstimate: 96000,
    assetKey: "paf-boiler-1",
    code: "1.2.1",
    status: "FUNDED",
    descriptionEl: "Ο λέβητας είναι σε κατάσταση Ε, με διαρροές και χωρίς διαθέσιμα ανταλλακτικά.",
    projectTitle: "Αντικατάσταση λεβητοστασίου",
    raisedDaysAgo: 70,
    by: "dev-admin",
  },
  {
    unit: "paphos-general",
    titleEl: "Επισκευή θερμομόνωσης δικτύου ζεστού νερού",
    kind: "REPAIR",
    riskBand: "LOW",
    costEstimate: 6800,
    assetKey: null,
    code: "1.1.2",
    status: "DONE",
    descriptionEl: "Αντικατάσταση φθαρμένης μόνωσης στις σωληνώσεις ζεστού νερού του ισογείου.",
    closedDaysAgo: 28,
    raisedDaysAgo: 80,
    by: "dev-admin",
  },
  {
    unit: "paphos-general",
    titleEl: "Αναβάθμιση πίνακα πυρανίχνευσης σε διευθυνσιοδοτούμενο",
    kind: "UPGRADE",
    riskBand: "MODERATE",
    costEstimate: 31000,
    assetKey: "paf-fire-panel",
    code: "2.2.11",
    status: "OPEN",
    descriptionEl: "Ο υπάρχων πίνακας δεν δείχνει ποιος ανιχνευτής έδωσε συναγερμό· ζητείται διευθυνσιοδοτούμενο σύστημα.",
    raisedDaysAgo: 25,
    by: "dev-admin",
  },
  // Famagusta: the auto-drafted fire panel, the air handler funded by its project, one done, one open.
  {
    unit: "famagusta-general",
    titleEl: "Αντικατάσταση: Κεντρικός πίνακας πυρανίχνευσης Αμμοχώστου",
    kind: "REPLACEMENT",
    riskBand: "HIGH",
    costEstimate: null,
    assetKey: "fam-fire-panel",
    code: "2.2.11",
    status: "OPEN",
    descriptionEl: "Τρεις ή περισσότερες διορθωτικές εντολές στο ίδιο πάγιο μέσα σε δώδεκα μήνες.",
    auto: {
      reason: "THREE_CORRECTIVE_IN_12_MONTHS",
      orderTitles: [
        "Ψευδής συναγερμός πυρανίχνευσης στη ζώνη 3",
        "Βλάβη τροφοδοτικού του πίνακα πυρανίχνευσης",
        "Απώλεια επικοινωνίας βρόχου 1 του πίνακα πυρανίχνευσης",
      ],
    },
    by: null,
  },
  {
    unit: "famagusta-general",
    titleEl: "Αντικατάσταση κλιματιστικής μονάδας ΚΚΜ-Α1",
    kind: "REPLACEMENT",
    riskBand: "SIGNIFICANT",
    costEstimate: 108000,
    assetKey: "fam-ahu-1",
    code: "1.2.1",
    status: "FUNDED",
    descriptionEl: "Η μονάδα είναι σε κατάσταση Ε και έχει περάσει τον προβλεπόμενο κύκλο ζωής.",
    projectTitle: "Αντικατάσταση συστήματος κλιματισμού",
    raisedDaysAgo: 75,
    by: "dev-admin",
  },
  {
    unit: "famagusta-general",
    titleEl: "Αντικατάσταση πιεστικού δοχείου ύδρευσης",
    kind: "REPAIR",
    riskBand: "LOW",
    costEstimate: 4200,
    assetKey: "fam-booster",
    code: "1.1.2",
    status: "DONE",
    descriptionEl: "Αντικατάσταση του πιεστικού δοχείου με νέο ίδιας χωρητικότητας.",
    closedDaysAgo: 42,
    raisedDaysAgo: 100,
    by: "dev-admin",
  },
  {
    unit: "famagusta-general",
    titleEl: "Πιστοποίηση δικτύου ιατρικών αερίων",
    kind: "STATUTORY",
    riskBand: "HIGH",
    costEstimate: 5800,
    assetKey: null,
    code: "1.1.3",
    status: "OPEN",
    descriptionEl: "Η περιοδική πιστοποίηση του δικτύου λήγει φέτος και δεν καλύπτεται από τη σύμβαση συντήρησης.",
    raisedDaysAgo: 20,
    by: "dev-admin",
  },
];

// ----------------------------------------------------------------- run --

export async function seedMaintenanceRegister(db: Db): Promise<MaintenanceSeedSummary> {
  const summary: MaintenanceSeedSummary = {
    estateAreas: 0,
    estateAssets: 0,
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

  // ------------------------------------------- the three added estates --
  // Before the lookups below, because an order points at these rooms and
  // machines. A building, a floor and a room are found by their codes, an
  // asset by (unit, Greek name) and keeps the tag it was issued.
  for (const estate of ESTATES) {
    const [building] = await db
      .insert(schema.building)
      .values({ orgUnitId: estate.orgUnitId, ...estate.building })
      .onConflictDoUpdate({
        target: [schema.building.orgUnitId, schema.building.code],
        set: { nameEl: estate.building.nameEl, updatedAt: sql`now()` },
      })
      .returning({ id: schema.building.id });
    for (const floor of estate.floors) {
      const [floorRow] = await db
        .insert(schema.floor)
        .values({
          buildingId: building.id,
          orgUnitId: estate.orgUnitId,
          code: floor.code,
          nameEl: floor.nameEl,
          level: floor.level,
        })
        .onConflictDoUpdate({
          target: [schema.floor.buildingId, schema.floor.code],
          set: { nameEl: floor.nameEl, level: floor.level, updatedAt: sql`now()` },
        })
        .returning({ id: schema.floor.id });
      for (const room of floor.areas) {
        await db
          .insert(schema.area)
          .values({ floorId: floorRow.id, orgUnitId: estate.orgUnitId, ...room })
          .onConflictDoUpdate({
            target: [schema.area.floorId, schema.area.code],
            set: {
              nameEl: room.nameEl,
              areaType: room.areaType,
              patientRiskGroup: room.patientRiskGroup,
              costCentre: room.costCentre,
              beds: room.beds,
              updatedAt: sql`now()`,
            },
          });
        summary.estateAreas += 1;
      }
    }
  }

  const estateAreas = await db
    .select({ id: schema.area.id, code: schema.area.code, orgUnitId: schema.area.orgUnitId })
    .from(schema.area);
  const estateAreaByUnitCode = new Map(estateAreas.map((a) => [`${a.orgUnitId}:${a.code}`, a.id]));
  for (const [index, fixtureAsset] of ESTATE_ASSETS.entries()) {
    const codes = ESTATE_CODES[fixtureAsset.orgUnitId];
    const [year, rest] = [Number(fixtureAsset.installed.slice(0, 4)), fixtureAsset.installed.slice(4)];
    const values = {
      orgUnitId: fixtureAsset.orgUnitId,
      areaId: fixtureAsset.areaCode
        ? (estateAreaByUnitCode.get(`${fixtureAsset.orgUnitId}:${fixtureAsset.areaCode}`) ?? null)
        : null,
      nameEl: fixtureAsset.nameEl,
      assetClass: fixtureAsset.assetClass,
      manufacturer: fixtureAsset.manufacturer,
      model: fixtureAsset.model,
      serialNo: `${fixtureAsset.key.toUpperCase()}-${year}`,
      installedDate: fixtureAsset.installed,
      commissionedDate: fixtureAsset.installed,
      capitalCost: fixtureAsset.capitalCost.toFixed(2),
      warrantyEnd: `${year + 3}${rest}`,
      expectedLifeYears: fixtureAsset.lifeYears,
      replacementYear: fixtureAsset.replacementYear,
      replacementCostEst: fixtureAsset.replacementCostEst.toFixed(2),
      criticality: fixtureAsset.criticality,
      condition: fixtureAsset.condition,
      // The CHECK says a band and a date come together or not at all.
      conditionAssessedAt: new Date(`${fixtureAsset.installed}T09:00:00Z`),
      system: fixtureAsset.system,
      costCentre: codes.costCentre,
      sapAssetNo: `${codes.sap}-${String(300001 + index)}`,
      status: "IN_SERVICE" as const,
    };
    const [existing] = await db
      .select({ id: schema.asset.id })
      .from(schema.asset)
      .where(and(eq(schema.asset.orgUnitId, fixtureAsset.orgUnitId), eq(schema.asset.nameEl, fixtureAsset.nameEl)))
      .limit(1);
    if (existing) {
      // The tag is not in the update. It was issued once and is on a label.
      await db.update(schema.asset).set({ ...values, updatedAt: sql`now()` }).where(eq(schema.asset.id, existing.id));
    } else {
      await db.insert(schema.asset).values({
        ...values,
        tag: sql`ecapital.allocate_asset_tag(${fixtureAsset.orgUnitId}::text, ${fixtureAsset.assetClass}::ecapital.asset_class)`,
      });
    }
    summary.estateAssets += 1;
  }

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
  for (const fixtureAsset of [...seedAssets, ...ESTATE_ASSETS]) {
    const row = assets.find(
      (a) => a.orgUnitId === fixtureAsset.orgUnitId && a.nameEl === fixtureAsset.nameEl,
    );
    if (row) assetByKey.set(fixtureAsset.key, row);
  }

  const areaByUnitCode = estateAreaByUnitCode;

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

    const wanted = CATALOGUE_CODES[seed.orgUnitId];
    const lines = wanted
      ? fixture.responseTimes.filter((line) => wanted.includes(line.code))
      : fixture.responseTimes;
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
    scheduleIdByTitle.set(`${seed.unit}:${seed.titleEl}`, id);
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
      pmScheduleId: seed.scheduleTitle ? (scheduleIdByTitle.get(`${seed.unit}:${seed.scheduleTitle}`) ?? null) : null,
      titleEl: seed.titleEl,
      descriptionEl: seed.descriptionEl ?? null,
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
      partsNoteEl: seed.partsNoteEl ?? null,
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
    orderIdByTitle.set(`${seed.unit}:${seed.titleEl}`, {
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
      events.push({ kind: "ESCALATED", at: escalatedAt, byId: null, noteEl: "Ο χρόνος ανταπόκρισης πέρασε χωρίς απάντηση από τον ανάδοχο." });
    }
    if (seed.status === "PAUSED") {
      events.push({ kind: "PAUSED", at: new Date(calledAt.getTime() + 2 * HOUR_MS), byId: by, noteEl: seed.noteEl ?? null });
    }
    if (seed.extensionDays) {
      events.push({ kind: "EXTENSION", at: new Date(calledAt.getTime() + 6 * HOUR_MS), byId: userBySubject.get(COORDINATOR[seed.unit] ?? "dev-admin") ?? by, noteEl: `${seed.extensionDays} εργάσιμες ημέρες: ${seed.extensionReasonEl}` });
    }
    // A free remark on an order that is neither paused nor cancelled is said
    // at the moment the system works again; the ones typed during the work
    // carry their own hour.
    if (seed.noteEl && seed.status !== "PAUSED" && seed.status !== "CANCELLED") {
      const at = restoredAt ?? completedAt ?? calledAt;
      events.push({ kind: "NOTE", at: new Date(at.getTime() + 60_000), byId: by, noteEl: seed.noteEl });
    }
    for (const [hours, text] of seed.notes ?? []) {
      events.push({ kind: "NOTE", at: new Date(calledAt.getTime() + hours * HOUR_MS), byId: by, noteEl: text });
    }
    if (restoredAt && seed.kind !== "PM") events.push({ kind: "RESTORED", at: restoredAt, byId: by });
    if (completedAt) events.push({ kind: "COMPLETED", at: completedAt, byId: by });
    if (cancelledAt) events.push({ kind: "CANCELLED", at: cancelledAt, byId: by, noteEl: seed.noteEl ?? null });
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
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
      .map((title) => orderIdByTitle.get(`${seed.unit}:${title}`))
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
      raisedAt: source ? new Date(source.calledAt.getTime() + 24 * HOUR_MS) : new Date(now - (seed.raisedDaysAgo ?? 30) * DAY_MS),
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
