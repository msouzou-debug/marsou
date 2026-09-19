import type { OrgUnit } from "@ecapital/shared";

// CAPEX-03 §3 — the org unit seed and its aliases (the exact source
// spelling from column D of the capex plan workbook, kept so a later
// import can match the next revision even if it renames a unit).
//
// RECONCILIATION FINDING (kept as history — it is what the eleven below were
// decided from, before HQ made it twelve): CAPEX-01 §4 says the register
// covers "nine hospitals plus three services and 20 of them belong to units
// that are not hospitals" (i.e. twelve org units, by that count). CAPEX-03
// §3 lists eleven distinct values in column D: eight hospitals (Λευκωσίας,
// Λάρνακας, Πάφου, Λεμεσού, Τροόδους, ΝΑΜΙΙΙ, Πόλεως Χρυσοχούς, Αμμοχώστου)
// and three services (ΔΥΨΥ, ΠΦΥ, Υπηρεσία Ασθενοφόρων) — not nine hospitals.
// This file used to list exactly those eleven units, with no twelfth unit
// invented to square the two documents against each other.
//
// HQ (owner decision, 19/09/2026) is the actual twelfth unit, and it is not
// that reconciliation's missing hospital: it is Central Administration
// itself, type CENTRAL, added because it can own capital projects too (IT,
// HQ works) and CAPEX-01 §4's "nine hospitals plus three services" never
// claimed to cover it — the Capex Plan sheet simply has no HQ rows to count.
//
// Directorate assignment is not printed next to each unit in CAPEX-03 §3,
// so it is derived here from the row-count arithmetic in that section:
// the directorate totals (Λεμεσού–Πάφου 44, Λευκωσίας 29,
// Λάρνακας–Αμμοχώστου 19, ΔΥΨΥ 11, ΠΦΥ 5, Ασθενοφόρων 4 — summing to 113,
// the exact total project-row count) match only one grouping of the
// eleven Capex Plan units, which is the one used below. HQ's directorate,
// KENTRIKI_DIOIKISI, has no such arithmetic behind it — it is the one
// directorate with no row in the sheet at all.
// ADR-0019: `entityCode` is the eFinance entity code for the same unit
// (INTEGRATION-eMAP §2), which is also the SAP Fund Center. It is not the
// `code` above — Πάφος is PAF here and PAP there, Λεμεσός LMS and LGH,
// Μακάριος NAM3 and ARC — which is exactly why both exist. HQ is the one
// unit where the two agree: eFinance's own code for Κεντρικά Γραφεία is
// also `HQ`.
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
    entityCode: "PAP",
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΠΑΦΟΥ"],
  },
  {
    id: "limassol-general",
    code: "LMS",
    nameEl: "Γενικό Νοσοκομείο Λεμεσού",
    nameEn: "Limassol General Hospital",
    type: "HOSPITAL",
    directorate: "LEMESOU_PAFOU",
    costCentre: "CC-LMS-01",
    entityCode: "LGH",
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΛΕΜΕΣΟΥ"],
  },
  {
    id: "troodos",
    code: "TRD",
    nameEl: "Νοσοκομείο Τροόδους",
    nameEn: "Troodos Hospital",
    type: "HOSPITAL",
    directorate: "LEMESOU_PAFOU",
    costCentre: "CC-TRD-01",
    entityCode: "TRD",
    timezone: "Europe/Nicosia",
    // Troodos and Kyperounta are one hospital (owner decision, 18/09/2026):
    // both spellings resolve here so a future sheet revision cannot split them.
    aliases: ["ΝΟΣΟΚΟΜΕΙΟ ΤΡΟΟΔΟΥΣ", "ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ", "Ν. ΚΥΠΕΡΟΥΝΤΑΣ"],
  },
  {
    id: "namiii",
    code: "NAM3",
    nameEl: "Νοσοκομείο Αρχιεπίσκοπος Μακάριος Γ΄",
    nameEn: "Archbishop Makarios III Hospital",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: "CC-NAM3-01",
    entityCode: "ARC",
    timezone: "Europe/Nicosia",
    aliases: ["ΝΑΜΙΙΙ"],
  },
  {
    id: "polis-chrysochous",
    code: "PCH",
    nameEl: "Νοσοκομείο Πόλεως Χρυσοχούς",
    nameEn: "Polis Chrysochous Hospital",
    type: "HOSPITAL",
    directorate: "LEMESOU_PAFOU",
    costCentre: "CC-PCH-01",
    entityCode: "CHR",
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
    timezone: "Europe/Nicosia",
    aliases: ["Γ.Ν. ΑΜΜΟΧΩΣΤΟΥ"],
  },
  {
    id: "dypsy",
    code: "DYP",
    nameEl: "Διεύθυνση Υπηρεσιών Ψυχικής Υγείας",
    nameEn: "Mental Health Services",
    type: "SERVICE",
    directorate: "DYPSY",
    costCentre: "CC-DYP-01",
    entityCode: "MH",
    timezone: "Europe/Nicosia",
    aliases: ["ΔΥΨΥ"],
  },
  {
    id: "pfy",
    code: "PFY",
    nameEl: "Πρωτοβάθμια Φροντίδα Υγείας",
    nameEn: "Primary Healthcare",
    type: "SERVICE",
    directorate: "PFY",
    costCentre: "CC-PFY-01",
    entityCode: "HC",
    timezone: "Europe/Nicosia",
    aliases: ["ΠΡΩΤΟΒΑΘΜΙΑ ΦΡΟΝΤΙΔΑ ΥΓΕΙΑΣ"],
  },
  {
    id: "ambulance",
    code: "AMB",
    nameEl: "Υπηρεσία Ασθενοφόρων",
    nameEn: "Ambulance Service",
    type: "SERVICE",
    directorate: "AMBULANCE",
    costCentre: "CC-AMB-01",
    entityCode: "AMB",
    timezone: "Europe/Nicosia",
    aliases: ["ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ"],
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
    timezone: "Europe/Nicosia",
    aliases: [],
  },
];
