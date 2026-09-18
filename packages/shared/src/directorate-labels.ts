import type { Directorate } from "./org-unit";

// CAPEX-01 §4 / CAPEX-03 §3: the six directorates, bilingual. Stored on
// org_unit, never derived from it (Troodos sits under Λεμεσού–Πάφου and
// nothing in its name says so).
export const directorateLabels: Record<Directorate, { el: string; en: string }> = {
  LEMESOU_PAFOU: { el: "Λεμεσού–Πάφου", en: "Limassol–Paphos" },
  LEFKOSIAS: { el: "Λευκωσίας", en: "Nicosia" },
  LARNAKAS_AMMOCHOSTOU: { el: "Λάρνακας–Αμμοχώστου", en: "Larnaca–Famagusta" },
  DYPSY: { el: "ΔΥΨΥ", en: "Mental Health Services" },
  PFY: { el: "Πρωτοβάθμια Φροντίδα Υγείας", en: "Primary Healthcare" },
  AMBULANCE: { el: "Υπηρεσία Ασθενοφόρων", en: "Ambulance Service" },
};
