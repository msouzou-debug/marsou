/**
 * The fallback reader — and, until eFinance publishes
 * `GET /api/v1/master/budget-codes?kind=capex`, the only one anybody's
 * environment actually calls (ADR-0025).
 *
 * `BudgetCodesService` picks this reader whenever `EFINANCE_URL` or
 * `EFINANCE_TOKEN` is not configured. Its twenty rows are the same twenty
 * migration `0013_contract_budget_code.sql` seeds, kept in step by hand: the
 * five the owner named by number and description on 19/09/2026, and fifteen
 * placeholders clearly marked in Greek with «(προσωρινή περιγραφή)» because
 * nobody has published the real fifteen yet. Running
 * `POST /budget-codes/sync` against this reader is therefore a no-op in the
 * common case — it exists so the route behaves the same way whether or not
 * eFinance is configured, and so a database that has drifted from the seed
 * (a row edited by hand, one marked inactive by mistake) can be put back.
 */
import type { BudgetCodeSource } from "@ecapital/shared";
import type { BudgetCodeSourceReader, RawBudgetCode } from "./budget-code-source";

export const SEED_BUDGET_CODES: readonly RawBudgetCode[] = [
  // ---- the five the owner named (19/09/2026) — real eFinance text -------
  { code: "7402", descriptionEl: "Ιατρικός και λοιπός εξοπλισμός", descriptionEn: "Medical and other equipment", category: "equipment", isCapex: true },
  { code: "7501", descriptionEl: "Μηχανήματα και εξοπλισμός", descriptionEn: "Machinery and equipment", category: "equipment", isCapex: true },
  { code: "7502", descriptionEl: "Κλιματισμός", descriptionEn: "Air conditioning", category: "equipment", isCapex: true },
  { code: "7551", descriptionEl: "Επιβατικά οχήματα", descriptionEn: "Passenger vehicles", category: "vehicles", isCapex: true },
  { code: "7585", descriptionEl: "Ασθενοφόρα", descriptionEn: "Ambulances", category: "vehicles", isCapex: true },
  // ---- fifteen placeholders — invented, not eFinance's confirmed text ---
  { code: "7401", descriptionEl: "Κτίρια (προσωρινή περιγραφή)", descriptionEn: "Buildings (placeholder description)", category: "buildings", isCapex: true },
  { code: "7403", descriptionEl: "Έπιπλα και λοιπός εξοπλισμός γραφείου (προσωρινή περιγραφή)", descriptionEn: "Furniture and office equipment (placeholder description)", category: "equipment", isCapex: true },
  { code: "7404", descriptionEl: "Ηλεκτρονικός εξοπλισμός και λογισμικό (προσωρινή περιγραφή)", descriptionEn: "Electronic equipment and software (placeholder description)", category: "it", isCapex: true },
  { code: "7405", descriptionEl: "Εξοπλισμός επικοινωνιών (προσωρινή περιγραφή)", descriptionEn: "Communications equipment (placeholder description)", category: "it", isCapex: true },
  { code: "7406", descriptionEl: "Εργαστηριακός εξοπλισμός (προσωρινή περιγραφή)", descriptionEn: "Laboratory equipment (placeholder description)", category: "equipment", isCapex: true },
  { code: "7503", descriptionEl: "Εργαλεία και μηχανήματα συντήρησης (προσωρινή περιγραφή)", descriptionEn: "Tools and maintenance machinery (placeholder description)", category: "equipment", isCapex: true },
  { code: "7504", descriptionEl: "Εξοπλισμός ασφαλείας (προσωρινή περιγραφή)", descriptionEn: "Security equipment (placeholder description)", category: "equipment", isCapex: true },
  { code: "7505", descriptionEl: "Επίπλωση νοσηλευτικών μονάδων (προσωρινή περιγραφή)", descriptionEn: "Ward furnishing (placeholder description)", category: "equipment", isCapex: true },
  { code: "7506", descriptionEl: "Ανελκυστήρες (προσωρινή περιγραφή)", descriptionEn: "Lifts (placeholder description)", category: "buildings", isCapex: true },
  { code: "7507", descriptionEl: "Ηλεκτρομηχανολογικές εγκαταστάσεις (προσωρινή περιγραφή)", descriptionEn: "Electromechanical installations (placeholder description)", category: "works", isCapex: true },
  { code: "7552", descriptionEl: "Φορτηγά οχήματα (προσωρινή περιγραφή)", descriptionEn: "Goods vehicles (placeholder description)", category: "vehicles", isCapex: true },
  { code: "7553", descriptionEl: "Δίκυκλα οχήματα (προσωρινή περιγραφή)", descriptionEn: "Motorcycles (placeholder description)", category: "vehicles", isCapex: true },
  { code: "7561", descriptionEl: "Ανακαινίσεις κτιρίων (προσωρινή περιγραφή)", descriptionEn: "Building renovations (placeholder description)", category: "works", isCapex: true },
  { code: "7562", descriptionEl: "Έργα υποδομής (προσωρινή περιγραφή)", descriptionEn: "Infrastructure works (placeholder description)", category: "works", isCapex: true },
  { code: "7563", descriptionEl: "Περιβάλλων χώρος και οδοποιία (προσωρινή περιγραφή)", descriptionEn: "Grounds and roadworks (placeholder description)", category: "works", isCapex: true },
];

export class SeedBudgetCodeReader implements BudgetCodeSourceReader {
  readonly source: BudgetCodeSource = "SEED";

  async read(): Promise<RawBudgetCode[]> {
    return [...SEED_BUDGET_CODES];
  }
}
