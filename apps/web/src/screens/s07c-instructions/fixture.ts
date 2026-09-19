// S07c — fixture shared by the preview and the test file. Obviously fake
// figures for a fake contract, per CAPEX-01 §15.
import type { SiteInstruction } from "@ecapital/shared";

export function buildInstructions(): SiteInstruction[] {
  return [
    {
      id: "instr-1",
      contractId: "contract-1",
      orgUnitId: "larnaca-general",
      number: 2,
      textEl: "Προσθέστε δεύτερη σειρά ηχομονωτικών πάνελ στον θάλαμο μηχανημάτων.",
      issuedById: "user-engineer",
      issuedByName: "Ελένη Χριστοδούλου",
      issuedAt: "2026-06-02T09:00:00.000Z",
      costImpactFlag: true,
      variationId: null,
    },
    {
      id: "instr-2",
      contractId: "contract-1",
      orgUnitId: "larnaca-general",
      number: 3,
      textEl: "Μετατοπίστε τον ηλεκτρικό πίνακα μακριά από την είσοδο πλυντηρίου.",
      issuedById: "user-engineer",
      issuedByName: "Ελένη Χριστοδούλου",
      issuedAt: "2026-07-10T09:00:00.000Z",
      costImpactFlag: true,
      variationId: "variation-linked-1",
    },
    {
      id: "instr-3",
      contractId: "contract-1",
      orgUnitId: "larnaca-general",
      number: 1,
      textEl: "Μεταφέρετε τον χώρο φύλαξης υλικών στον βόρειο περιβάλλοντα χώρο.",
      issuedById: "user-engineer",
      issuedByName: "Ελένη Χριστοδούλου",
      issuedAt: "2026-01-20T09:00:00.000Z",
      costImpactFlag: false,
      variationId: null,
    },
  ];
}
