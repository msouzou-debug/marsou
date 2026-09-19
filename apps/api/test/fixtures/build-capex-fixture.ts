/**
 * The synthetic capex plan the importer is built and proved against, until
 * the real MASTER_FILE arrives (R41).
 *
 *   node -r @swc-node/register test/fixtures/build-capex-fixture.ts
 *
 * Deterministic: the same script produces the same figures every time, so a
 * test can assert a total to the cent. There is no randomness beyond a small
 * seeded generator, and no data from the real workbook — every title is made
 * up, and the only things copied from CAPEX-03 are the header texts, the unit
 * spellings and the totals the import has to reproduce (§0).
 *
 * Deterministic in its contents, not in its bytes: exceljs stamps the zip
 * entries with the time of the run, so two builds of the same data differ as
 * files and agree cell for cell. The committed .xlsx files are the ones the
 * tests read, and one test rebuilds into a temporary directory and compares
 * the cells, which is what keeps them honest.
 *
 * The totals:
 *
 *   113 project rows, 3 footer rows
 *   O €275,087,583 · S €101,113,949
 *   U €65,224,025 · V €62,897,204 · W €44,630,443 · X €2,616,272
 *   AF €71,591,105 · AG €66,004,161 · AH €42,672,530 · AI €3,970,001
 *   (AI follows from §0's prior-vintage total of €184,237,797)
 *
 * Four variants:
 *
 *   `main`    the file as §0 describes it, defects and all: text in three
 *             date cells and three amount cells, so V06 fires and the run
 *             cannot be committed until somebody fixes the spreadsheet.
 *   `clean`   the same file with those six cells corrected to 0 — what
 *             Monday's file looks like after the defects are fixed, and the
 *             only variant that can be committed.
 *   `changed` `clean` with one project's estimated cost €48,500 higher, for
 *             the diff against the previous import (§9).
 *   `moved`   a column shifted and a footer line renamed, to prove that
 *             `inspect` finds the move and that the row counts stop the run.
 *
 * A fifth file, `probe`, carries one row for each rule that fires on nothing
 * in the February file (V04, V07, V10, V11, V12, V13, V14) so the rules have
 * something to fire on. It has its own profile, test/fixtures/capex_plan_probe.yaml.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import ExcelJS from "exceljs";

// ---------------------------------------------------------------- figures --

const TOTALS = {
  O: 275_087_583,
  S: 101_113_949,
  U: 65_224_025,
  V: 62_897_204,
  W: 44_630_443,
  X: 2_616_272,
  AF: 71_591_105,
  AG: 66_004_161,
  AH: 42_672_530,
  AI: 3_970_001,
  M: 69_222_423,
  N: 141_900_000,
};

const PROJECT_ROWS = 113;
const HEADER_ROW = 4;
const FIRST_DATA_ROW = 6;

/** CAPEX-03 §2, the header of every column, spelled as the sheet spells it. */
const HEADERS: [string, string][] = [
  ["A", "ΚΑΤΗΓΟΡΙΑ ΔΑΠΑΝΗΣ"],
  ["B", "Α/Α"],
  ["C", "Διεύθυνση"],
  ["D", "ΝΟΣΟΚΟΜΕΙΟ"],
  ["E", "ΕΡΓΟ"],
  ["F", "ΑΡΘΡΟ"],
  ["G", ""],
  ["H", "Δεσμεύσεις ΠτΚΔ?"],
  ["I", "Στο Σχέδιο Δράσης?"],
  ["J", "Προϋπολογισμός 2026?"],
  ["K", "Συμβατική Υποχρέωση"],
  ["L", "Χρηματοδότηση από 3ους?"],
  ["M", "Ποσό Χρηματοδότησης"],
  ["N", "Ποσό Χρηματοδότησης (Αναθεωρημένο)"],
  ["O", "ΕΚΤΙΜΩΜΕΝΗ ΣΥΝΟΛΙΚΗ ΔΑΠΑΝΗ (incl. VAT)"],
  ["P", "Ημερομηνία έναρξης"],
  ["Q", "Ημερομηνία ολοκλήρωσης"],
  ["R", "% Υλοποίησης"],
  ["S", "Πραγματική δαπάνη από αρχή έργου μέχρι 03/2026"],
  ["T", "Εκτιμώμενη δαπάνη υπόλοιπο 2026"],
  ["U", "ΔΑΠΑΝΗ 2026"],
  ["V", "ΔΑΠΑΝΗ 2027"],
  ["W", "ΔΑΠΑΝΗ 2028"],
  ["X", "ΔΑΠΑΝΕΣ ΜΕΤΑ ΤΟ 2028"],
  ["Y", "ΣΥΝΟΛΟ"],
  ["Z", "TOTALS CHECK"],
  ["AA", "ΣΤΑΔΙΟ ΥΛΟΠΟΙΗΣΗΣ"],
  ["AB", "Αναθεωρημένη ημ. έναρξης"],
  ["AC", "Αναθεωρημένη ημ. ολοκλήρωσης"],
  ["AD", "Σχόλια από Τεχνικό Τμήμα"],
  ["AE", "Αρχείο Εσωτερικού Ελέγχου"],
  ["AF", "ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ 2025"],
  ["AG", "ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ 2026"],
  ["AH", "ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ 2027"],
  ["AI", "ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ μετά το 2027"],
  ["AJ", "ΣΥΝΟΛΟ"],
];

/** CAPEX-03 §3: the eleven units, their directorate and their row count. */
const UNITS: { spelling: string; directorate: string; rows: number }[] = [
  { spelling: "Γ.Ν. ΛΕΥΚΩΣΙΑΣ", directorate: "ΛΕΥΚΩΣΙΑΣ", rows: 20 },
  { spelling: "Γ.Ν. ΛΑΡΝΑΚΑΣ", directorate: "ΛΑΡΝΑΚΑΣ-ΑΜΜΟΧΩΣΤΟΥ", rows: 14 },
  { spelling: "Γ.Ν. ΠΑΦΟΥ", directorate: "ΛΕΜΕΣΟΥ-ΠΑΦΟΥ", rows: 13 },
  { spelling: "Γ.Ν. ΛΕΜΕΣΟΥ", directorate: "ΛΕΜΕΣΟΥ-ΠΑΦΟΥ", rows: 13 },
  { spelling: "ΝΟΣΟΚΟΜΕΙΟ ΤΡΟΟΔΟΥΣ", directorate: "ΛΕΜΕΣΟΥ-ΠΑΦΟΥ", rows: 12 },
  { spelling: "ΔΥΨΥ", directorate: "ΔΥΨΥ", rows: 11 },
  { spelling: "ΝΑΜΙΙΙ", directorate: "ΛΕΥΚΩΣΙΑΣ", rows: 9 },
  { spelling: "ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΕΩΣ ΧΡΥΣΟΧΟΥΣ", directorate: "ΛΕΜΕΣΟΥ-ΠΑΦΟΥ", rows: 7 },
  { spelling: "Γ.Ν. ΑΜΜΟΧΩΣΤΟΥ", directorate: "ΛΑΡΝΑΚΑΣ-ΑΜΜΟΧΩΣΤΟΥ", rows: 5 },
  { spelling: "ΠΡΩΤΟΒΑΘΜΙΑ ΦΡΟΝΤΙΔΑ ΥΓΕΙΑΣ", directorate: "ΠΦΥ", rows: 5 },
  { spelling: "ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ", directorate: "ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ", rows: 4 },
];

/** Plausible works, not lorem ipsum. Combined with a place to make a title. */
const WORKS = [
  "Ανακαίνιση χειρουργείων",
  "Επέκταση ΤΑΕΠ",
  "Αναβάθμιση συστήματος κλιματισμού",
  "Αντικατάσταση ανελκυστήρων",
  "Ανακαίνιση θαλάμων νοσηλείας",
  "Νέα μονάδα εντατικής θεραπείας",
  "Αναβάθμιση ηλεκτρολογικής εγκατάστασης",
  "Εγκατάσταση εφεδρικής γεννήτριας",
  "Ανακαίνιση μαγειρείων",
  "Αντικατάσταση δικτύου ιατρικών αερίων",
  "Στεγάνωση δώματος",
  "Αναβάθμιση πυρασφάλειας",
  "Διαμόρφωση χώρων εξωτερικών ιατρείων",
  "Ανακαίνιση αποδυτηρίων προσωπικού",
  "Επέκταση χώρου στάθμευσης",
  "Αναβάθμιση μηχανοστασίου",
  "Αντικατάσταση κουφωμάτων",
  "Ανακαίνιση ακτινολογικού τμήματος",
  "Δημιουργία μονάδας τεχνητού νεφρού",
  "Αναβάθμιση βιολογικού καθαρισμού",
  "Ανακαίνιση φαρμακείου",
  "Εγκατάσταση φωτοβολταϊκών",
  "Αναβάθμιση συστήματος κλήσης νοσηλευτή",
  "Ανακαίνιση αιμοδοσίας",
  "Διαμόρφωση χώρου αποστείρωσης",
  "Αντικατάσταση λεβήτων",
  "Ανακαίνιση μικροβιολογικού εργαστηρίου",
  "Αναβάθμιση δικτύου ύδρευσης",
  "Επέκταση αποθηκευτικών χώρων",
  "Ανακαίνιση παθολογικής κλινικής",
];

const WINGS = [
  "Α΄ πτέρυγας",
  "Β΄ πτέρυγας",
  "Γ΄ πτέρυγας",
  "ισογείου",
  "πρώτου ορόφου",
  "δεύτερου ορόφου",
  "παλαιάς πτέρυγας",
  "νέας πτέρυγας",
];

const NOTES = [
  "Η μελέτη εφαρμογής ολοκληρώθηκε και εκκρεμεί η έγκριση της Τεχνικής Επιτροπής. Η καθυστέρηση οφείλεται στην αναθεώρηση των προδιαγραφών κλιματισμού.",
  "Ο διαγωνισμός κηρύχθηκε άγονος και επαναπροκηρύχθηκε. Νέα ημερομηνία υποβολής προσφορών εντός του πρώτου τριμήνου.",
  "Οι εργασίες εκτελούνται τμηματικά, ώστε το τμήμα να παραμένει σε λειτουργία. Η ολοκλήρωση μετατίθεται κατά ένα τρίμηνο.",
  "Εκκρεμεί η άδεια οικοδομής από την αρμόδια αρχή. Το χρονοδιάγραμμα αναθεωρήθηκε ανάλογα.",
  "Η σύμβαση υπογράφηκε και ο ανάδοχος εγκαταστάθηκε στο εργοτάξιο. Δεν υπάρχουν εκκρεμότητες.",
  "Απαιτήθηκε συμπληρωματική μελέτη στατικής επάρκειας, η οποία μετέθεσε την έναρξη των εργασιών.",
  "Η προμήθεια του εξοπλισμού καθυστερεί λόγω χρόνου παράδοσης από τον κατασκευαστή. Παρακολουθείται σε μηνιαία βάση.",
  "Το έργο εντάχθηκε στο Σχέδιο Ανάκαμψης και Ανθεκτικότητας και ακολουθεί το χρονοδιάγραμμα του Σχεδίου.",
];

// ------------------------------------------------------------ small tools --

/** A seeded generator, so the file is the same on every machine. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** Whole euros, summing to exactly `total`, every share at least `floorEach`. */
function distribute(total: number, weights: number[], floorEach = 0): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const body = total - floorEach * count;
  if (body < 0) throw new Error(`cannot give ${count} rows at least ${floorEach} out of ${total}`);
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * body);
  const out = raw.map((v) => Math.floor(v) + floorEach);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k += 1, rest -= 1) out[order[k % count].i] += 1;
  return out;
}

const dateOf = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

// ------------------------------------------------------------- the model --

interface Row {
  index: number;
  rowNo: number;
  unit: string;
  directorate: string;
  title: string;
  category: string | null;
  aa: string | number | null;
  article: string | number | null;
  h: string | null;
  i: string | null;
  j: string | null;
  k: string | null;
  l: string | null;
  m: number | null;
  n: number | null;
  o: number | null;
  p: Date | string | null;
  q: Date | string | null;
  s: number | null;
  u: number | string | null;
  v: number | null;
  w: number | string | null;
  x: number | null;
  phase: string;
  ab: Date | string | null;
  ac: Date | string | null;
  ad: string | null;
  ae: string | null;
  af: number | null;
  ag: number | string | null;
  ah: number | null;
  ai: number | null;
  /** Row of the sheet whose % formula is the old variant (CAPEX-03 §6). */
  oldPercentFormula: boolean;
}

const PHASE_PREP = "ΣΤΑΔΙΟ ΠΡΟΕΤΟΙΜΑΣΙΑΣ";
const PHASE_PROGRESS = "ΣΕ ΕΞΕΛΙΞΗ";
const PHASE_DONE = "ΟΛΟΚΛΗΡΩΘΗΚΕ";

// Index sets. Explicit rather than derived, so what the fixture contains can
// be read off the file rather than run.
const NO_COST = [4, 11, 19, 26, 33, 41, 48, 55, 62, 70, 77, 84, 91, 99, 106]; // 15, V02
const NO_CATEGORY = [2, 13, 24, 35, 46, 57, 68, 79, 90]; // 9, V03
const NO_ARTICLE = [1, 6, 12, 18, 23, 29, 34, 40, 45, 51, 56, 61, 67, 72, 78, 83, 89]; // 17, V05
const ARTICLE_NO = 95; // «ΟΧΙ», the eighteenth V05
const TEXT_DATE = { p: 30, q: 60, ab: 88 }; // 3 rows, V06
const TEXT_W = 44; // V06
const TEXT_AG = [50, 71]; // V06
const TINY_DEVIATION = { two: 64, one: 87 }; // €2 and €1, inside V01's ±€10
const TOTALS_CHECK_DEFECTS = [14, 16]; // CAPEX-03 §6 defects 1 and 2

function buildRows(): Row[] {
  const rnd = lcg(20_260_219);
  const rows: Row[] = [];

  let index = 0;
  for (const unit of UNITS) {
    for (let n = 0; n < unit.rows; n += 1) {
      const work = WORKS[(index * 7 + n) % WORKS.length];
      const wing = WINGS[(index + n) % WINGS.length];
      rows.push({
        index,
        rowNo: FIRST_DATA_ROW + index,
        unit: unit.spelling,
        directorate: unit.directorate,
        title: `${work} ${wing}`,
        category: "Αναπτυξιακά Έργα",
        aa: index + 1,
        article: ["08021", "08022", "08023"][index % 3],
        h: null,
        i: null,
        j: "ΝΑΙ",
        k: null,
        l: null,
        m: null,
        n: null,
        o: null,
        p: null,
        q: null,
        s: null,
        u: null,
        v: null,
        w: null,
        x: null,
        phase: PHASE_PREP,
        ab: null,
        ac: null,
        ad: null,
        ae: null,
        af: null,
        ag: null,
        ah: null,
        ai: null,
        oldPercentFormula: false,
      });
      index += 1;
    }
  }
  if (rows.length !== PROJECT_ROWS) throw new Error(`built ${rows.length} rows, not ${PROJECT_ROWS}`);

  // Two titles CAPEX-03 §5 names, and one with a trailing parenthetical the
  // importer has to split into the note (§2 col E).
  rows[3].title = "ΕΠΕΚΤΑΣΗ ΤΑΕΠ ΛΕΥΚΩΣΙΑΣ";
  rows[52].title = "ΑΝΑΚΑΙΝΙΣΗ ΤΑΕΠ";
  rows[8].title = "Αντικατάσταση κουφωμάτων Β΄ πτέρυγας (μικρές ανάγκες 2026)";
  // Titles have to be unique inside a unit: that is the natural key (§2 col E).
  const used = new Set<string>();
  for (const row of rows) {
    let title = row.title;
    let n = 2;
    while (used.has(`${row.unit}::${title}`)) {
      title = `${row.title} — φάση ${n}`;
      n += 1;
    }
    row.title = title;
    used.add(`${row.unit}::${title}`);
  }

  const withCost = rows.filter((r) => !NO_COST.includes(r.index));
  if (withCost.length !== 98) throw new Error(`expected 98 rows with a cost, got ${withCost.length}`);

  // Phases (§4): 22 finished, 21 running, 70 in preparation. Every row
  // without an estimated cost is in preparation — a project nobody has
  // costed has not started.
  const eligible = withCost.filter((r) => ![3, 52].includes(r.index));
  const done = eligible.filter((_, i) => i % 4 === 1).slice(0, 22);
  const doneIds = new Set(done.map((r) => r.index));
  const progress = eligible.filter((r) => !doneIds.has(r.index)).filter((_, i) => i % 3 === 0).slice(0, 21);
  const progressIds = new Set(progress.map((r) => r.index));
  for (const row of rows) {
    if (doneIds.has(row.index)) row.phase = PHASE_DONE;
    else if (progressIds.has(row.index)) row.phase = PHASE_PROGRESS;
    else row.phase = PHASE_PREP;
  }

  // The one finished project at 79% (§5 V08, §6 defect 3).
  const seventyNine = done[5];
  seventyNine.oldPercentFormula = true;

  const prep = withCost.filter((r) => r.phase === PHASE_PREP);
  const running = withCost.filter((r) => r.phase === PHASE_PROGRESS);

  // --- S: cumulative actual spend to 03/2026 -------------------------------
  // Everything finished has been paid for; the running projects are part way
  // through; twenty of the preparation rows have early design fees on them.
  const spenders = [...done, ...running, ...prep.filter((_, i) => i % 3 === 0).slice(0, 20)];
  const sShares = distribute(
    TOTALS.S,
    spenders.map((r) => (doneIds.has(r.index) ? 3 + rnd() * 6 : progressIds.has(r.index) ? 2 + rnd() * 4 : 0.2 + rnd())),
    1_000,
  );
  spenders.forEach((row, i) => {
    row.s = sShares[i];
  });

  // --- U, V, W, X: the February 2026 forecast ------------------------------
  // A finished project has no forecast left, except the one at 79%, whose
  // remaining fifth sits in 2026.
  const seventyNineU = Math.round(((seventyNine.s as number) * 21) / 79);
  seventyNine.u = seventyNineU;

  const uRows = [...running, ...prep];
  const uShares = distribute(
    TOTALS.U - seventyNineU,
    uRows.map((r) => (progressIds.has(r.index) ? 2 + rnd() * 5 : 0.5 + rnd() * 3)),
    1_000,
  );
  uRows.forEach((row, i) => {
    row.u = uShares[i];
  });

  const vRows = [...running, ...prep];
  const vShares = distribute(
    TOTALS.V,
    vRows.map(() => 0.4 + rnd() * 4),
    500,
  );
  vRows.forEach((row, i) => {
    row.v = vShares[i];
  });

  // 2028 is for what has not started. The row that holds text in W takes no
  // share of the column, because a text cell adds up as nothing in Excel too.
  const wRows = prep.filter((r) => r.index !== TEXT_W);
  const wShares = distribute(
    TOTALS.W,
    wRows.map(() => 0.3 + rnd() * 3),
    500,
  );
  wRows.forEach((row, i) => {
    row.w = wShares[i];
  });

  const xRows = prep.filter((_, i) => i % 3 === 1).slice(0, 18);
  const xShares = distribute(
    TOTALS.X,
    xRows.map(() => 0.5 + rnd()),
    1_000,
  );
  xRows.forEach((row, i) => {
    row.x = xShares[i];
  });

  // --- O: what each project is estimated to cost ---------------------------
  // O ties to S + U + V + W + X on every row except the four CAPEX-03 §5
  // names: two that miss by a lot and two that miss by rounding.
  for (const row of withCost) {
    row.o = num(row.s) + num(row.u) + num(row.v) + num(row.w) + num(row.x);
  }
  rows[3].o = (rows[3].o as number) - 515_565;
  rows[52].o = (rows[52].o as number) - 878_742;
  rows[TINY_DEVIATION.two].o = (rows[TINY_DEVIATION.two].o as number) - 2;
  rows[TINY_DEVIATION.one].o = (rows[TINY_DEVIATION.one].o as number) - 1;

  // --- M and N: external funding ------------------------------------------
  // Sixteen rows carry ΣΑΑ money, and none of them more than the project
  // costs — V12 passes on the column that is imported. Column N is the one
  // that does not add up (§2), and it is read and logged, never written.
  const byCost = [...withCost].sort((a, b) => (b.o as number) - (a.o as number));
  const funded = byCost.slice(0, 16);
  const fundedTotal = funded.reduce((sum, r) => sum + (r.o as number), 0);
  if (fundedTotal < TOTALS.M) {
    throw new Error(`the sixteen funded rows only cost ${fundedTotal}, under the €${TOTALS.M} of ΣΑΑ money`);
  }
  const mShares = waterFill(
    TOTALS.M,
    funded.map((r) => r.o as number),
  );
  funded.forEach((row, i) => {
    row.m = mShares[i];
    row.l = "ΣΑΑ";
  });
  const revised = byCost.slice(0, 15);
  const nShares = distribute(TOTALS.N - 70_900_000, revised.slice(1).map(() => 1 + rnd()), 100_000);
  revised.forEach((row, i) => {
    row.n = i === 0 ? 70_900_000 : nShares[i - 1];
  });

  // --- the prior vintage, columns AF–AI ------------------------------------
  const priorRows = rows.filter((_, i) => i % 5 !== 4); // 91 of the 113
  const agRows = priorRows.filter((r) => !TEXT_AG.includes(r.index));
  assign(priorRows, TOTALS.AF, rnd, (row, value) => (row.af = value));
  assign(agRows, TOTALS.AG, rnd, (row, value) => (row.ag = value));
  assign(priorRows, TOTALS.AH, rnd, (row, value) => (row.ah = value));
  assign(
    priorRows.filter((_, i) => i % 4 === 2),
    TOTALS.AI,
    rnd,
    (row, value) => (row.ai = value),
  );

  // --- the flag columns and the dates --------------------------------------
  // 38 rows carry a contractual commitment, and exactly one of them is still
  // in preparation — that is the V09 row §5 counts.
  const committed = [...done, ...running].slice(0, 37);
  for (const row of committed) row.k = "ΝΑΙ";
  const preparationButCommitted = prep.find((r) => r.o !== null && r.index !== TEXT_W);
  if (!preparationButCommitted) throw new Error("no preparation row to carry the V09 commitment");
  preparationButCommitted.k = "ΝΑΙ";

  rows.forEach((row, i) => {
    if (i % 3 === 0) row.h = i === 12 ? "ΝΑΙ - €129.5" : "ΝΑΙ";
    if (i % 4 === 1) row.i = `ΝΑΙ - 13.${String(20 + (i % 9)).padStart(2, "0")}`;
    if (i === 27) row.j = "ΝΑΙ (μόνο δαπάνη 2026)";
    if (i < 78) row.ae = "ΝΑΙ";
    if (i % 3 !== 2 && i < 111) row.ad = NOTES[i % NOTES.length];

    const startYear = 2024 + (i % 3);
    row.p = dateOf(startYear, 1 + (i % 12), 1 + (i % 27));
    row.q = dateOf(startYear + 2, 1 + ((i + 5) % 12), 1 + ((i + 9) % 27));
    if (i % 3 === 0) {
      row.ab = dateOf(startYear + 1, 1 + ((i + 2) % 12), 1 + ((i + 3) % 27));
      row.ac = dateOf(startYear + 3, 1 + ((i + 7) % 12), 1 + ((i + 11) % 27));
    }
  });
  // The notes are 74 of the 113 (§2 col AD).
  const noteCount = rows.filter((r) => r.ad !== null).length;
  for (let i = rows.length - 1, over = noteCount - 74; over > 0 && i >= 0; i -= 1) {
    if (rows[i].ad !== null) {
      rows[i].ad = null;
      over -= 1;
    }
  }

  // --- the blanks and the defects ------------------------------------------
  for (const i of NO_COST) {
    rows[i].o = null;
    rows[i].s = null;
    rows[i].u = null;
    rows[i].v = null;
    rows[i].w = null;
    rows[i].x = null;
  }
  for (const i of NO_CATEGORY) rows[i].category = null;
  for (const i of NO_ARTICLE) rows[i].article = null;
  rows[ARTICLE_NO].article = "ΟΧΙ";
  // Seven rows hold text in Α/Α and four are blank (§2 col B).
  [5, 17, 31, 47, 63, 81, 97].forEach((i, n) => {
    rows[i].aa = `${n + 1}α`;
  });
  [9, 28, 66, 104].forEach((i) => {
    rows[i].aa = null;
  });

  rows[TEXT_DATE.p].p = "εντός 2026";
  rows[TEXT_DATE.q].q = "δεν έχει οριστεί";
  rows[TEXT_DATE.ab].ab = "αναμένεται έγκριση";
  rows[TEXT_W].w = "περίπου 1,2 εκ.";
  for (const i of TEXT_AG) rows[i].ag = "υπό αναθεώρηση";

  return rows;
}

function assign(
  rows: Row[],
  total: number,
  rnd: () => number,
  set: (row: Row, value: number) => void,
): void {
  const shares = distribute(
    total,
    rows.map(() => 0.4 + rnd() * 3),
    500,
  );
  rows.forEach((row, i) => set(row, shares[i]));
}

/** Shares of `total` proportional to `caps`, never above the cap. */
function waterFill(total: number, caps: number[]): number[] {
  const out = new Array<number>(caps.length).fill(0);
  let remaining = total;
  let open = caps.map((_, i) => i);
  while (remaining > 0 && open.length) {
    const openSum = open.reduce((sum, i) => sum + caps[i], 0);
    let spilled = false;
    const round = open.map((i) => Math.floor((caps[i] / openSum) * remaining));
    open.forEach((i, k) => {
      const give = Math.min(round[k], caps[i] - out[i]);
      if (give < round[k]) spilled = true;
      out[i] += give;
      remaining -= give;
    });
    open = open.filter((i) => out[i] < caps[i]);
    if (!spilled && remaining > 0) {
      for (const i of open) {
        if (remaining === 0) break;
        out[i] += 1;
        remaining -= 1;
      }
    }
  }
  return out;
}

function num(value: number | string | null): number {
  return typeof value === "number" ? value : 0;
}

// ------------------------------------------------------------- the sheet --

export type Variant = "main" | "clean" | "changed" | "moved";

export const SHEET_NAME = "Α)Capex Plan-Updated - clean";
/** The row the `changed` variant moves, and by how much (§9 diff). */
export const CHANGED_ROW_INDEX = 7;
export const CHANGED_DELTA = 48_500;

function letters(): string[] {
  return HEADERS.map(([letter]) => letter);
}

function index(letter: string): number {
  let out = 0;
  for (const ch of letter) out = out * 26 + (ch.charCodeAt(0) - 64);
  return out;
}

export async function buildFixture(variant: Variant, outPath: string): Promise<string> {
  const rows = buildRows();

  if (variant === "clean" || variant === "changed") {
    // Monday's file, once the six typed-wrong cells are corrected. They were
    // adding up as nothing, so a zero keeps every column total where it was.
    rows[TEXT_DATE.p].p = null;
    rows[TEXT_DATE.q].q = null;
    rows[TEXT_DATE.ab].ab = null;
    rows[TEXT_W].w = 0;
    for (const i of TEXT_AG) rows[i].ag = 0;
  }
  if (variant === "changed") {
    rows[CHANGED_ROW_INDEX].o = (rows[CHANGED_ROW_INDEX].o as number) + CHANGED_DELTA;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital fixture builder";
  workbook.created = new Date(Date.UTC(2026, 1, 19));
  workbook.modified = workbook.created;
  const sheet = workbook.addWorksheet(SHEET_NAME);

  sheet.getCell("A1").value =
    "MASTER_FILE - ΑΝΑΠΤΥΞΙΑΚΟΣ ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ - Αναθεώρηση Budget 2026 (συνθετικό αρχείο δοκιμών)";
  sheet.getCell("A2").value = "Δεν περιέχει πραγματικά στοιχεία. Παράγεται από build-capex-fixture.ts.";

  // `moved` shifts everything from ΑΡΘΡΟ rightwards by one column, which is
  // what a column inserted by hand does to a file.
  const shiftFrom = variant === "moved" ? index("F") : Number.POSITIVE_INFINITY;
  const at = (letter: string): number => {
    const i = index(letter);
    return i >= shiftFrom ? i + 1 : i;
  };

  for (const [letter, header] of HEADERS) {
    if (header) sheet.getRow(HEADER_ROW).getCell(at(letter)).value = header;
  }
  if (variant === "moved") {
    sheet.getRow(HEADER_ROW).getCell(index("F")).value = "ΚΩΔΙΚΟΣ SAP";
  }

  const put = (rowNo: number, letter: string, value: ExcelJS.CellValue): void => {
    if (value === null || value === undefined) return;
    sheet.getRow(rowNo).getCell(at(letter)).value = value;
  };

  for (const row of rows) {
    const r = row.rowNo;
    const total = num(row.s) + num(row.u) + num(row.v) + num(row.w) + num(row.x);
    const priorTotal = num(row.af) + num(row.ag) + num(row.ah) + num(row.ai);
    put(r, "A", row.category);
    put(r, "B", row.aa);
    put(r, "C", row.directorate);
    put(r, "D", row.unit);
    put(r, "E", row.title);
    put(r, "F", row.article);
    put(r, "H", row.h);
    put(r, "I", row.i);
    put(r, "J", row.j);
    put(r, "K", row.k);
    put(r, "L", row.l);
    put(r, "M", row.m);
    put(r, "N", row.n);
    put(r, "O", row.o);
    put(r, "P", row.p);
    put(r, "Q", row.q);
    // CAPEX-03 §6 defect 3: one row still carries the formula variant from
    // before the "finished means 100%" branch was added, which is why a
    // finished project reports 79%.
    put(r, "R", {
      formula: row.oldPercentFormula
        ? `IFERROR(S${r}/O${r},0%)`
        : `IF(AA${r}="ΟΛΟΚΛΗΡΩΘΗΚΕ",100%,IFERROR(S${r}/O${r},0%))`,
      result: row.o ? num(row.s) / (row.o as number) : 0,
    });
    put(r, "S", row.s);
    put(r, "U", row.u);
    put(r, "V", row.v);
    put(r, "W", row.w);
    put(r, "X", row.x);
    put(r, "Y", { formula: `SUM(S${r}:X${r})`, result: total });
    // CAPEX-03 §6 defects 1 and 2: two TOTALS CHECK formulas point at the
    // next row's estimated cost, so they report FALSE on rows that tie.
    const checkAgainst = TOTALS_CHECK_DEFECTS.includes(row.index) ? r + 1 : r;
    put(r, "Z", {
      formula: `ROUND(Y${r},-1)=ROUND(O${checkAgainst},-1)`,
      result: checkAgainst === r && row.o !== null ? Math.round(total / 10) === Math.round((row.o as number) / 10) : false,
    });
    put(r, "AA", row.phase);
    put(r, "AB", row.ab);
    put(r, "AC", row.ac);
    put(r, "AD", row.ad);
    put(r, "AE", row.ae);
    put(r, "AF", row.af);
    put(r, "AG", row.ag);
    put(r, "AH", row.ah);
    put(r, "AI", row.ai);
    put(r, "AJ", { formula: `SUM(AF${r}:AI${r})`, result: priorTotal });
  }

  // The three footer rows, with blank rows between them exactly as the real
  // file has: the importer finds them by what is in column E, never by row
  // number (CAPEX-03 §1).
  const lastRow = FIRST_DATA_ROW + PROJECT_ROWS - 1;
  const totalsRow = lastRow + 5;
  const rrfRow = totalsRow + 3;
  const netRow = rrfRow + 2;

  const sumOf = (letter: string): number =>
    rows.reduce((sum, row) => {
      const value = (row as unknown as Record<string, unknown>)[letter.toLowerCase()];
      return sum + (typeof value === "number" ? value : 0);
    }, 0);

  sheet.getRow(totalsRow).getCell(at("E")).value =
    variant === "moved" ? "ΣΥΝΟΛΑ ΑΝΑΠΤΥΞΙΑΚΟΥ" : "ΣΥΝΟΛΟ";
  if (variant === "moved") {
    // A renamed footer line stops being a footer: columns A–D are filled in
    // as well, so the row classifies as a project and the counts refuse to
    // match. That is the stop CAPEX-03 §1 asks for.
    sheet.getRow(totalsRow).getCell(at("A")).value = "Αναπτυξιακά Έργα";
    sheet.getRow(totalsRow).getCell(at("D")).value = "Γ.Ν. ΛΕΥΚΩΣΙΑΣ";
  }
  for (const letter of ["O", "S", "U", "V", "W", "X", "AF", "AG", "AH", "AI"]) {
    const column = sheet.getRow(totalsRow).getCell(at(letter)).address.replace(/\d+/, "");
    sheet.getRow(totalsRow).getCell(at(letter)).value = {
      formula: `SUM(${column}${FIRST_DATA_ROW}:${column}${lastRow})`,
      result: sumOf(letter),
    };
  }

  sheet.getRow(rrfRow).getCell(at("E")).value = "ΑΠΟΖΗΜΙΩΣΗ ΑΠΌ ΣΑΑ";
  sheet.getRow(rrfRow).getCell(at("O")).value = TOTALS.M;
  sheet.getRow(rrfRow).getCell(at("U")).value = Math.round(TOTALS.M * 0.45);
  sheet.getRow(rrfRow).getCell(at("V")).value = Math.round(TOTALS.M * 0.35);
  sheet.getRow(rrfRow).getCell(at("W")).value = TOTALS.M - Math.round(TOTALS.M * 0.45) - Math.round(TOTALS.M * 0.35);

  // CAPEX-03 §0: "The large negatives in the file all come from row 128."
  sheet.getRow(netRow).getCell(at("E")).value = "ΔΑΠΑΝΗ (ΝΕΤ)";
  sheet.getRow(netRow).getCell(at("O")).value = -TOTALS.M;
  sheet.getRow(netRow).getCell(at("U")).value = -Math.round(TOTALS.M * 0.45);
  sheet.getRow(netRow).getCell(at("V")).value = -Math.round(TOTALS.M * 0.35);

  for (const letter of letters()) {
    sheet.getColumn(at(letter)).width = 18;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  await workbook.xlsx.writeFile(outPath);
  return outPath;
}

export const FIXTURE_DIR = __dirname;
export const fixturePath = (name: string): string => join(FIXTURE_DIR, name);

export const FIXTURES: { variant: Variant; file: string }[] = [
  { variant: "main", file: "capex-plan-synthetic.xlsx" },
  { variant: "clean", file: "capex-plan-synthetic-clean.xlsx" },
  { variant: "changed", file: "capex-plan-synthetic-changed.xlsx" },
  { variant: "moved", file: "capex-plan-moved-column.xlsx" },
];

export async function buildAll(): Promise<string[]> {
  const built: string[] = [];
  for (const { variant, file } of FIXTURES) {
    built.push(await buildFixture(variant, fixturePath(file)));
  }
  built.push(await buildProbe(fixturePath("capex-plan-probe.xlsx")));
  return built;
}

/**
 * A small file whose rows are built to fire the rules that nothing in the
 * February file fires: V04 (a unit nobody has heard of), V07 (a finish before
 * its start), V10 (negative actual spend), V11 (a footer total that does not
 * tie), V12 (funding larger than the project), V13 (the same unit and title
 * twice) and V14 (a negative forecast year).
 */
export async function buildProbe(outPath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital fixture builder";
  workbook.created = new Date(Date.UTC(2026, 1, 19));
  workbook.modified = workbook.created;
  const sheet = workbook.addWorksheet(SHEET_NAME);
  for (const [letter, header] of HEADERS) {
    if (header) sheet.getRow(HEADER_ROW).getCell(index(letter)).value = header;
  }

  interface Probe {
    unit: string;
    directorate: string;
    title: string;
    o: number | null;
    s: number | null;
    u: number | null;
    p?: Date;
    q?: Date;
    m?: number;
    phase?: string;
  }
  const probes: Probe[] = [
    // V04: a unit that is in no alias table.
    { unit: "Γ.Ν. ΚΕΡΥΝΕΙΑΣ", directorate: "ΛΕΥΚΩΣΙΑΣ", title: "Ανακαίνιση πτέρυγας", o: 100_000, s: 40_000, u: 60_000 },
    // V07: the finish comes before the start.
    {
      unit: "Γ.Ν. ΛΕΥΚΩΣΙΑΣ",
      directorate: "ΛΕΥΚΩΣΙΑΣ",
      title: "Αναβάθμιση πυρασφάλειας",
      o: 200_000,
      s: 50_000,
      u: 150_000,
      p: dateOf(2026, 9, 1),
      q: dateOf(2026, 3, 1),
    },
    // V10: negative actual spend.
    { unit: "Γ.Ν. ΛΑΡΝΑΚΑΣ", directorate: "ΛΑΡΝΑΚΑΣ-ΑΜΜΟΧΩΣΤΟΥ", title: "Αντικατάσταση λεβήτων", o: 80_000, s: -5_000, u: 85_000 },
    // V12: external funding larger than the project it funds.
    { unit: "Γ.Ν. ΠΑΦΟΥ", directorate: "ΛΕΜΕΣΟΥ-ΠΑΦΟΥ", title: "Νέα μονάδα εντατικής θεραπείας", o: 300_000, s: 100_000, u: 200_000, m: 450_000 },
    // V13: the same unit and the same title, twice.
    { unit: "Γ.Ν. ΛΕΜΕΣΟΥ", directorate: "ΛΕΜΕΣΟΥ-ΠΑΦΟΥ", title: "Στεγάνωση δώματος", o: 60_000, s: 20_000, u: 40_000 },
    { unit: "Γ.Ν. ΛΕΜΕΣΟΥ", directorate: "ΛΕΜΕΣΟΥ-ΠΑΦΟΥ", title: "Στεγάνωση  δώματος ", o: 60_000, s: 20_000, u: 40_000 },
    // V14: a negative forecast year.
    { unit: "ΔΥΨΥ", directorate: "ΔΥΨΥ", title: "Ανακαίνιση ξενώνα", o: 40_000, s: 45_000, u: -5_000 },
  ];

  probes.forEach((probe, i) => {
    const r = FIRST_DATA_ROW + i;
    sheet.getRow(r).getCell(index("A")).value = "Αναπτυξιακά Έργα";
    sheet.getRow(r).getCell(index("B")).value = i + 1;
    sheet.getRow(r).getCell(index("C")).value = probe.directorate;
    sheet.getRow(r).getCell(index("D")).value = probe.unit;
    sheet.getRow(r).getCell(index("E")).value = probe.title;
    sheet.getRow(r).getCell(index("F")).value = "08021";
    if (probe.m) sheet.getRow(r).getCell(index("M")).value = probe.m;
    if (probe.o !== null) sheet.getRow(r).getCell(index("O")).value = probe.o;
    if (probe.p) sheet.getRow(r).getCell(index("P")).value = probe.p;
    if (probe.q) sheet.getRow(r).getCell(index("Q")).value = probe.q;
    if (probe.s !== null) sheet.getRow(r).getCell(index("S")).value = probe.s;
    if (probe.u !== null) sheet.getRow(r).getCell(index("U")).value = probe.u;
    sheet.getRow(r).getCell(index("AA")).value = probe.phase ?? PHASE_PREP;
  });

  const totalsRow = FIRST_DATA_ROW + probes.length + 2;
  sheet.getRow(totalsRow).getCell(index("E")).value = "ΣΥΝΟΛΟ";
  // V11: deliberately €1,000 away from what the rows add up to.
  sheet.getRow(totalsRow).getCell(index("O")).value =
    probes.reduce((sum, p) => sum + (p.o ?? 0), 0) + 1_000;
  sheet.getRow(totalsRow).getCell(index("S")).value = probes.reduce((sum, p) => sum + (p.s ?? 0), 0);
  sheet.getRow(totalsRow).getCell(index("U")).value = probes.reduce((sum, p) => sum + (p.u ?? 0), 0);
  for (const letter of ["V", "W", "X", "AF", "AG", "AH", "AI"]) {
    sheet.getRow(totalsRow).getCell(index(letter)).value = 0;
  }
  sheet.getRow(totalsRow + 2).getCell(index("E")).value = "ΑΠΟΖΗΜΙΩΣΗ ΑΠΌ ΣΑΑ";
  sheet.getRow(totalsRow + 4).getCell(index("E")).value = "ΔΑΠΑΝΗ (ΝΕΤ)";

  mkdirSync(dirname(outPath), { recursive: true });
  await workbook.xlsx.writeFile(outPath);
  return outPath;
}

if (require.main === module) {
  buildAll()
    .then((files) => {
      for (const file of files) console.log(`built ${file}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
