import type { OrgUnit } from "@ecapital/shared";

// CAPEX-03 §3 — the org unit seed and its aliases (the exact source
// spelling from column D of the capex plan workbook, kept so a later
// import can match the next revision even if it renames a unit).
//
// RECONCILIATION FINDING (kept as history — it is what the eleven below were
// decided from, before HQ made it twelve and the Ambulance Service brought it
// back to eleven): CAPEX-01 §4 says the register covers "nine hospitals plus
// three services and 20 of them belong to units that are not hospitals" (i.e.
// twelve org units, by that count). CAPEX-03 §3 lists eleven distinct values
// in column D: eight hospitals (Λευκωσίας, Λάρνακας, Πάφου, Λεμεσού,
// Τροόδους, ΝΑΜΙΙΙ, Πόλεως Χρυσοχούς, Αμμοχώστου) and three services (ΔΥΨΥ,
// ΠΦΥ, Υπηρεσία Ασθενοφόρων) — not nine hospitals. This file used to list
// exactly those eleven units, with no twelfth unit invented to square the two
// documents against each other.
//
// HQ (owner decision, 19/09/2026) is the actual twelfth unit, and it is not
// that reconciliation's missing hospital: it is Central Administration
// itself, type CENTRAL, added because it can own capital projects too (IT,
// HQ works) and CAPEX-01 §4's "nine hospitals plus three services" never
// claimed to cover it — the Capex Plan sheet simply has no HQ rows to count.
//
// THE AMBULANCE SERVICE IS OUT (owner decision, 19/09/2026 — ADR-0024).
// Υπηρεσία Ασθενοφόρων is no longer part of ΟΚΥπΥ, so it is not a unit of
// this register and its four Capex Plan rows are not ΟΚΥπΥ's capital works.
// Eight hospitals, two services and HQ: eleven. Migration 0012 removes the
// unit from a database that already has it, and the Excel importer rejects
// the «ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ» spelling (V15) instead of resolving it.
//
// TWELVE (owner decision, 20/09/2026 — ADR-0024's addendum). «Κοινοτική
// Νοσηλευτική Υπηρεσία» (Community Nursing Service) gets its own unit,
// correcting yesterday's errata, which had it filing under HQ with none —
// see `community-nursing` below. It carries a cost centre of none and no
// projects yet, the same starting point HQ had.
//
// Directorate assignment is not printed next to each unit in CAPEX-03 §3,
// so it is derived here from the row-count arithmetic in that section:
// the directorate totals (Λεμεσού–Πάφου 44, Λευκωσίας 29,
// Λάρνακας–Αμμοχώστου 19, ΔΥΨΥ 11, ΠΦΥ 5, Ασθενοφόρων 4 — summing to 113,
// the exact total project-row count) match only one grouping of the
// eleven Capex Plan units, which is the one used below. HQ's directorate,
// KENTRIKI_DIOIKISI, has no such arithmetic behind it — it is the one
// directorate with no row in the sheet at all. Community Nursing's
// directorate, PFY, has none either, and is an ASSUMPTION (it sits under
// Primary Healthcare) that the owner has yet to confirm.
//
// ADR-0024: `code` and `entityCode` are now the same string for every unit —
// eArchive's site abbreviation, which eFinance and eCapital both adopt.
//
// ADR-0022's addendum (owner decision, 20/09/2026): eFinance keeps its own
// entity keys permanently — it will not rename them, they are foreign keys
// across twelve of its own tables and in SAP — so the codes `entityCode`
// replaced (PAP, LGH, ARC, CHR, MH, HC, TRD) are carried here too, as
// `efinanceCode`, a second column rather than a lookup document. The cost
// centres below do not move with either code: a cost centre is SAP's
// identifier for a place, the Οικονομική Διεύθυνση's to change.
export const orgUnits: (OrgUnit & { aliases: string[] })[] = [
  {
    id: "nicosia-general",
    code: "NGH",
    nameEl: "Γενικό Νοσοκομείο Λευκωσίας",
    nameEn: "Nicosia General Hospital",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: "CC-NGH-01",
    entityCode: "NGH",
    efinanceCode: "NGH",
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΛΕΥΚΩΣΙΑΣ"],
  },
  {
    id: "larnaca-general",
    code: "LAR",
    nameEl: "Γενικό Νοσοκομείο Λάρνακας",
    nameEn: "Larnaca General Hospital",
    type: "HOSPITAL",
    directorate: "LARNAKAS_AMMOCHOSTOU",
    costCentre: "CC-LAR-01",
    entityCode: "LAR",
    efinanceCode: "LAR",
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΛΑΡΝΑΚΑΣ"],
  },
  {
    id: "paphos-general",
    code: "PAF",
    nameEl: "Γενικό Νοσοκομείο Πάφου",
    nameEn: "Paphos General Hospital",
    type: "HOSPITAL",
    directorate: "LEMESOU_PAFOU",
    costCentre: "CC-PAF-01",
    entityCode: "PAF",
    efinanceCode: "PAP",
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΠΑΦΟΥ"],
  },
  {
    id: "limassol-general",
    code: "LGH",
    nameEl: "Γενικό Νοσοκομείο Λεμεσού",
    nameEn: "Limassol General Hospital",
    type: "HOSPITAL",
    directorate: "LEMESOU_PAFOU",
    costCentre: "CC-LMS-01",
    entityCode: "LGH",
    efinanceCode: "LGH",
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΛΕΜΕΣΟΥ"],
  },
  {
    id: "troodos",
    code: "KYP",
    nameEl: "Νοσοκομείο Τροόδους",
    nameEn: "Troodos Hospital",
    type: "HOSPITAL",
    directorate: "LEMESOU_PAFOU",
    costCentre: "CC-TRD-01",
    entityCode: "KYP",
    efinanceCode: "TRD",
    timezone: "Europe/Nicosia",
    // Troodos and Kyperounta are one hospital (owner decision, 18/09/2026):
    // both spellings resolve here so a future sheet revision cannot split them.
    // eArchive files the place under the Kyperounta abbreviation, which is
    // why the code is KYP while both names stay Τροόδους (ADR-0024).
    aliases: ["ΝΟΣΟΚΟΜΕΙΟ ΤΡΟΟΔΟΥΣ", "ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ", "Ν. ΚΥΠΕΡΟΥΝΤΑΣ"],
  },
  {
    id: "namiii",
    code: "NAM",
    nameEl: "Νοσοκομείο Αρχιεπίσκοπος Μακάριος Γ΄",
    nameEn: "Archbishop Makarios III Hospital",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: "CC-NAM3-01",
    entityCode: "NAM",
    efinanceCode: "ARC",
    timezone: "Europe/Nicosia",
    aliases: ["ΝΑΜΙΙΙ"],
  },
  {
    id: "polis-chrysochous",
    code: "POL",
    nameEl: "Νοσοκομείο Πόλεως Χρυσοχούς",
    nameEn: "Polis Chrysochous Hospital",
    type: "HOSPITAL",
    directorate: "LEMESOU_PAFOU",
    costCentre: "CC-PCH-01",
    entityCode: "POL",
    efinanceCode: "CHR",
    timezone: "Europe/Nicosia",
    aliases: ["ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΕΩΣ ΧΡΥΣΟΧΟΥΣ"],
  },
  {
    id: "famagusta-general",
    code: "FAM",
    nameEl: "Γενικό Νοσοκομείο Αμμοχώστου",
    nameEn: "Famagusta General Hospital",
    type: "HOSPITAL",
    directorate: "LARNAKAS_AMMOCHOSTOU",
    costCentre: "CC-FAM-01",
    entityCode: "FAM",
    efinanceCode: "FAM",
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΑΜΜΟΧΩΣΤΟΥ"],
  },
  {
    id: "dypsy",
    code: "MHS",
    nameEl: "Διεύθυνση Υπηρεσιών Ψυχικής Υγείας",
    nameEn: "Mental Health Services",
    type: "SERVICE",
    directorate: "DYPSY",
    costCentre: "CC-DYP-01",
    entityCode: "MHS",
    efinanceCode: "MH",
    timezone: "Europe/Nicosia",
    aliases: ["ΔΥΨΥ"],
  },
  {
    id: "pfy",
    code: "PHC",
    nameEl: "Πρωτοβάθμια Φροντίδα Υγείας",
    nameEn: "Primary Healthcare",
    type: "SERVICE",
    directorate: "PFY",
    costCentre: "CC-PFY-01",
    entityCode: "PHC",
    efinanceCode: "HC",
    timezone: "Europe/Nicosia",
    aliases: ["ΠΡΩΤΟΒΑΘΜΙΑ ΦΡΟΝΤΙΔΑ ΥΓΕΙΑΣ"],
  },
  {
    // Owner decision, 19/09/2026. No cost centre, and no aliases — the Capex
    // Plan sheet has no HQ rows for a source spelling to come from.
    id: "hq",
    code: "HQ",
    nameEl: "Κεντρικά Γραφεία",
    nameEn: "Central Offices",
    type: "CENTRAL",
    directorate: "KENTRIKI_DIOIKISI",
    costCentre: null,
    entityCode: "HQ",
    efinanceCode: "HQ",
    timezone: "Europe/Nicosia",
    aliases: [],
  },
  {
    // Owner decision, 20/09/2026 (ADR-0024's addendum), correcting
    // yesterday's errata: Community Nursing is a unit of its own, not a gap
    // that files under HQ. No cost centre and no projects yet — the same
    // starting point HQ had. Directorate PFY is an ASSUMPTION (it sits under
    // Primary Healthcare), flagged for the owner to confirm.
    id: "community-nursing",
    code: "CNS",
    nameEl: "Κοινοτική Νοσηλευτική Υπηρεσία",
    nameEn: "Community Nursing Service",
    type: "SERVICE",
    directorate: "PFY",
    costCentre: null,
    entityCode: "CNS",
    efinanceCode: "CNS",
    timezone: "Europe/Nicosia",
    aliases: ["ΚΟΙΝΟΤΙΚΗ ΝΟΣΗΛΕΥΤΙΚΗ"],
  },
];
