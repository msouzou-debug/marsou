import type { Directorate } from "./org-unit";

// CAPEX-01 §4 / CAPEX-03 §3: the six directorates from the Capex Plan,
// bilingual. Stored on org_unit, never derived from it (Troodos sits under
// Λεμεσού–Πάφου and nothing in its name says so). KENTRIKI_DIOIKISI is a
// seventh, added by owner decision on 19/09/2026 alongside the HQ org unit —
// it has no row in the Capex Plan sheet, so CAPEX-03 §3 never counted it.
//
// AMBULANCE has no units under it since 19/09/2026 (ADR-0024) and is kept
// only so an audit-log before-image that names it still renders a word rather
// than a blank. S01 groups by the directorates of the units it is showing, so
// a directorate with no units never appears in the interface.
export const directorateLabels: Record<Directorate, { el: string; en: string }> = {
  LEMESOU_PAFOU: { el: "Λεμεσού–Πάφου", en: "Limassol–Paphos" },
  LEFKOSIAS: { el: "Λευκωσίας", en: "Nicosia" },
  LARNAKAS_AMMOCHOSTOU: { el: "Λάρνακας–Αμμοχώστου", en: "Larnaca–Famagusta" },
  DYPSY: { el: "ΔΥΨΥ", en: "Mental Health Services" },
  PFY: { el: "Πρωτοβάθμια Φροντίδα Υγείας", en: "Primary Healthcare" },
  AMBULANCE: { el: "Υπηρεσία Ασθενοφόρων", en: "Ambulance Service" },
  KENTRIKI_DIOIKISI: { el: "Κεντρική Διοίκηση", en: "Central Administration" },
};
