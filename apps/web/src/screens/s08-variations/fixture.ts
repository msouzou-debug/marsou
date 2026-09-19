// S08 — fixture shared by the test files.
import type { Variation } from "@ecapital/shared";

export function buildVariation(overrides: Partial<Variation> = {}): Variation {
  return {
    id: "variation-1",
    contractId: "contract-1",
    number: 4,
    descriptionEl: "Αναβάθμιση δαπέδων σε αντιστατικό υλικό",
    reason: "CLIENT_CHANGE",
    value: 48_000,
    timeImpactDays: 10,
    status: "SUBMITTED",
    raisedById: "user-engineer",
    raisedByName: "Γιώργος Ιωάννου",
    raisedAt: "2026-05-01T09:00:00.000Z",
    decidedById: null,
    decidedByName: null,
    decidedAt: null,
    decisionCommentEl: null,
    ...overrides,
  };
}
