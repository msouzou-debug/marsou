// S07b — fixture shared by the preview and the test file. Obviously fake
// figures for a fake contract, per CAPEX-01 §15. Dates are relative to `now`
// (an injectable `Date`) so the SLA band is a live fact about the fixture's
// own clock, the same reasoning `seedRfisEveryContract` gives in the API.
import { nicosiaDateOf, type Rfi } from "@ecapital/shared";

const HOUR = 3_600_000;

export function buildRfis(now: Date = new Date("2026-09-19T09:00:00.000Z")): Rfi[] {
  return [
    {
      id: "rfi-1",
      contractId: "contract-1",
      orgUnitId: "larnaca-general",
      number: 3,
      questionEl: "Πώς αντιμετωπίζεται η διαφορά υψομέτρου που βρέθηκε στη θεμελίωση;",
      answerEl: null,
      raisedById: "user-engineer",
      raisedByName: "Ελένη Χριστοδούλου",
      raisedAt: new Date(now.getTime() - 10 * 24 * HOUR).toISOString(),
      answeredById: null,
      answeredByName: null,
      answeredAt: null,
      slaDueAt: new Date(now.getTime() - 3 * 24 * HOUR).toISOString(),
      slaHours: 7 * 24,
      status: "OPEN",
      slaState: "BREACHED",
      recipientName: null,
      recipientEmail: null,
      sentOn: null,
    },
    {
      id: "rfi-2",
      contractId: "contract-1",
      orgUnitId: "larnaca-general",
      number: 2,
      questionEl: "Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;",
      answerEl: null,
      raisedById: "user-engineer",
      raisedByName: "Ελένη Χριστοδούλου",
      raisedAt: new Date(now.getTime() - 3 * 24 * HOUR).toISOString(),
      answeredById: null,
      answeredByName: null,
      answeredAt: null,
      slaDueAt: new Date(now.getTime() + 4 * 24 * HOUR).toISOString(),
      slaHours: 7 * 24,
      status: "OPEN",
      slaState: "GREEN",
      recipientName: "Μάριος Ανδρέου, Αρχιτεκτονικό γραφείο",
      recipientEmail: "m.andreou@architects.example",
      sentOn: null,
    },
    {
      id: "rfi-3",
      contractId: "contract-1",
      orgUnitId: "larnaca-general",
      number: 1,
      questionEl: "Ποια στάθμη τελειωμένου δαπέδου ισχύει στον διάδρομο του ισογείου;",
      answerEl: "Ισχύει η στάθμη του αρχιτεκτονικού σχεδίου, αναθεώρηση Γ.",
      raisedById: "user-engineer",
      raisedByName: "Ελένη Χριστοδούλου",
      raisedAt: new Date(now.getTime() - 30 * 24 * HOUR).toISOString(),
      answeredById: "user-engineer",
      answeredByName: "Ελένη Χριστοδούλου",
      answeredAt: new Date(now.getTime() - 26 * 24 * HOUR).toISOString(),
      slaDueAt: new Date(now.getTime() - 23 * 24 * HOUR).toISOString(),
      slaHours: 7 * 24,
      status: "CLOSED",
      slaState: "GREEN",
      recipientName: "Δοκιμαστική Εργοληπτική Λτδ",
      recipientEmail: null,
      sentOn: "2026-08-21",
      // Owner UAT 25/11/2026: the day the answer arrived, and the close.
      answeredOn: nicosiaDateOf(new Date(now.getTime() - 26 * 24 * HOUR)),
      closedById: "user-engineer",
      closedByName: "Ελένη Χριστοδούλου",
      closedAt: new Date(now.getTime() - 25 * 24 * HOUR).toISOString(),
      closingNote: "Η στάθμη εφαρμόστηκε στο εργοτάξιο.",
    },
  ];
}
