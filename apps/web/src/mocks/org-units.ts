import type { OrgUnit } from "@ecapital/shared";

// CAPEX-03 §3 — the org unit seed and its aliases (the exact source
// spelling from column D of the capex plan workbook, kept so a later
// import can match the next revision even if it renames a unit).
//
// RECONCILIATION FINDING: CAPEX-01 §4 says the register covers "nine
// hospitals plus three services and 20 of them belong to units that are
// not hospitals" (i.e. twelve org units). CAPEX-03 §3 lists eleven
// distinct values in column D: eight hospitals (Λευκωσίας, Λάρνακας,
// Πάφου, Λεμεσού, Τροόδους, ΝΑΜΙΙΙ, Πόλεως Χρυσοχούς, Αμμοχώστου) and
// three services (ΔΥΨΥ, ΠΦΥ, Υπηρεσία Ασθενοφόρων) — not nine hospitals.
// This file lists exactly the eleven units CAPEX-03 §3 gives; no twelfth
// unit is invented to square the two documents. Whoever owns the source
// workbook should confirm whether a hospital is missing from the sheet or
// whether CAPEX-01's "nine" is simply wrong.
//
// Directorate assignment is not printed next to each unit in CAPEX-03 §3,
// so it is derived here from the row-count arithmetic in that section:
// the directorate totals (Λεμεσού–Πάφου 44, Λευκωσίας 29,
// Λάρνακας–Αμμοχώστου 19, ΔΥΨΥ 11, ΠΦΥ 5, Ασθενοφόρων 4 — summing to 113,
// the exact total project-row count) match only one grouping of the
// eleven units, which is the one used below.
export const orgUnits: (OrgUnit & { aliases: string[] })[] = [
  {
    id: "nicosia-general",
    code: "NGH",
    nameEl: "Γενικό Νοσοκομείο Λευκωσίας",
    nameEn: "Nicosia General Hospital",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: "CC-NGH-01",
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
    timezone: "Europe/Nicosia",
    aliases: ["ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ"],
  },
];
