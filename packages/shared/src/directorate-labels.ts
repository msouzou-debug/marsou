import type { Directorate } from "./org-unit";

// CAPEX-01 §4 / CAPEX-03 §3: the six directorates from the Capex Plan,
// bilingual. Stored on org_unit, never derived from it (Troodos sits under
// Λεμεσού–Πάφου and nothing in its name says so). KENTRIKI_DIOIKISI is a
// seventh, added by owner decision on 19/09/2026 alongside the HQ org unit —
// it has no row in the Capex Plan sheet, so CAPEX-03 §3 never counted it.
export const directorateLabels: Record<Directorate, { el: string; en: string }> = {
  LEMESOU_PAFOU: { el: "Λεμεσού–Πάφου", en: "Limassol–Paphos" },
  LEFKOSIAS: { el: "Λευκωσίας", en: "Nicosia" },
  LARNAKAS_AMMOCHOSTOU: { el: "Λάρνακας–Αμμοχώστου", en: "Larnaca–Famagusta" },
  DYPSY: { el: "ΔΥΨΥ", en: "Mental Health Services" },
  PFY: { el: "Πρωτοβάθμια Φροντίδα Υγείας", en: "Primary Healthcare" },
  AMBULANCE: { el: "Υπηρεσία Ασθενοφόρων", en: "Ambulance Service" },
  KENTRIKI_DIOIKISI: { el: "Κεντρική Διοίκηση", en: "Central Administration" },
};
