/**
 * The synthetic SAP extracts the cost import is tested against (R14, R15).
 *
 * ADR-0016 took the same line for the capex plan: the real file is not in the
 * repository, so the fixture is built by a script and checked in, and the
 * script is what proves the fixture is still what the profile expects.
 *
 *   node -r @swc-node/register test/fixtures/build-sap-fixtures.ts
 *
 * OBVIOUSLY FAKE FIGURES, NO PATIENT DATA. Sequential document numbers, round
 * amounts, and vendor names that are plainly made up.
 *
 * Every awkward thing a Greek SAP client does to a cell is in here on
 * purpose, because it is the part that breaks:
 *
 *  - amounts as text in the European format, «1.234,56», and one with the
 *    minus sign on the right, «40.000,00-», which is how SAP writes a credit;
 *  - dates as text in «31.03.2026» form;
 *  - one amount cell holding «περίπου 3.000», which has to be refused and not
 *    read as three thousand or as zero (CAPEX-03 §5 V06 is the same rule);
 *  - the same document twice, because a clerk who reruns a report with an
 *    overlapping date range gets it twice;
 *  - rows that match on a WBS element, on a sub-element of one, on a purchase
 *    order and on a cost centre, and rows that match on nothing at all;
 *  - and, for the capital lines (ADR-0036), ISO and dd.mm.yyyy dates in one
 *    file, dot and comma decimals, a credit sent negative, an empty text with
 *    an assignment, and a CAP- reference that names no contract.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

export const SAP_FIXTURE_DIR = join(__dirname, "sap");

export function sapFixturePath(name: string): string {
  return join(SAP_FIXTURE_DIR, name);
}

/** The keys a test arranges in the register so these rows find a project. */
export const FIXTURE_KEYS = {
  wbsA: "C.COST-2026-001",
  wbsB: "C.COST-2026-002",
  purchaseOrder: "4500777001",
  costCentre: "CC9001",
  vendor: "ΑΛΦΑ ΤΕΧΝΙΚΗ ΛΤΔ",
};

interface Sheet {
  header: string[];
  rows: (string | number)[][];
}

/**
 * FBL1N, the matching month. These twelve rows were the ME2N fixture until
 * ADR-0036 retired ME2N; they keep every case the WBS → purchase order →
 * cost centre → rule matcher has to get right, now in the vendor line-item
 * layout FBL1N still accepts: four rows that match on a WBS element (one of
 * them on a sub-element), two on a purchase order, one on a cost centre,
 * three that match on nothing, one repeated document and one unreadable
 * amount. Amounts carry FBL1N's sign (an invoice negative, a credit note
 * positive) and the profile inverts them.
 */
export function fbl1nMatchingSheet(): Sheet {
  return {
    header: [
      "Document Number",
      "Line Item",
      "Document Date",
      "Posting Date",
      "Amount in local currency",
      "Text",
      "Name 1",
      "WBS Element",
      "Purchasing Document",
      "Cost Center",
      "G/L Account",
    ],
    rows: [
      ["4500777001", "10", "05.01.2026", "31.01.2026", "-120.000,00", "Οικοδομικές εργασίες", FIXTURE_KEYS.vendor, FIXTURE_KEYS.wbsA, "4500777001", "", "0802100"],
      ["4500777002", "10", "06.01.2026", "31.01.2026", "-45.500,50", "Ηλεκτρολογικές εγκαταστάσεις", "ΒΗΤΑ ΚΑΤΑΣΚΕΥΑΣΤΙΚΗ ΛΤΔ", `${FIXTURE_KEYS.wbsA}.2`, "4500777002", "", "0802100"],
      ["4500777003", "10", "07.01.2026", "28.02.2026", "-88.000,00", "Μηχανολογικές εγκαταστάσεις", FIXTURE_KEYS.vendor, FIXTURE_KEYS.wbsB, "4500777003", "", "0802100"],
      ["4500777004", "20", "08.01.2026", "28.02.2026", "-12.750,25", "Υδραυλικές εργασίες", "ΓΑΜΑ ΜΗΧΑΝΙΚΗ ΛΤΔ", `${FIXTURE_KEYS.wbsB}.1`, "4500777004", "", "0802100"],
      // Matched on the purchase order: no WBS on the line at all.
      [FIXTURE_KEYS.purchaseOrder, "30", "09.01.2026", "31.03.2026", "-31.400,00", "Συμπληρωματικές εργασίες", FIXTURE_KEYS.vendor, "", FIXTURE_KEYS.purchaseOrder, "", "0802100"],
      // A credit note: positive on the vendor account, negative in the ledger.
      [FIXTURE_KEYS.purchaseOrder, "40", "09.01.2026", "31.03.2026", "2.400,00", "Πιστωτικό σημείωμα", FIXTURE_KEYS.vendor, "", FIXTURE_KEYS.purchaseOrder, "", "0802100"],
      // Matched on the cost centre.
      ["4500777005", "10", "10.01.2026", "31.03.2026", "-9.900,00", "Προμήθεια εξοπλισμού", "ΔΕΛΤΑ ΕΞΟΠΛΙΣΜΟΙ ΛΤΔ", "", "4500777005", FIXTURE_KEYS.costCentre, "0802200"],
      // Nothing to match on.
      ["4500777006", "10", "11.01.2026", "31.03.2026", "-7.250,00", "Διάφορες εργασίες", "ΕΨΙΛΟΝ ΥΠΗΡΕΣΙΕΣ ΛΤΔ", "", "4500777006", "", "0802200"],
      ["4500777007", "10", "12.01.2026", "31.03.2026", "-5.100,00", "Εργασίες χρωματισμών", "ΖΗΤΑ ΧΡΩΜΑΤΑ ΛΤΔ", "", "4500777007", "", "0802200"],
      ["4500777008", "10", "13.01.2026", "31.03.2026", "-3.300,00", "Εργασίες μονώσεων", "ΗΤΑ ΜΟΝΩΣΕΙΣ ΛΤΔ", "", "4500777008", "", "0802200"],
      // The same document again, as a rerun with an overlapping range gives it.
      ["4500777001", "10", "05.01.2026", "31.01.2026", "-120.000,00", "Οικοδομικές εργασίες", FIXTURE_KEYS.vendor, FIXTURE_KEYS.wbsA, "4500777001", "", "0802100"],
      // Refused, never coerced.
      ["4500777009", "10", "14.01.2026", "31.03.2026", "περίπου 3.000", "Εργασίες υπό εκτίμηση", "ΘΗΤΑ ΤΕΧΝΙΚΗ ΛΤΔ", "", "4500777009", "", "0802200"],
    ],
  };
}

/**
 * FBL1N, the cost-centre month: the rows that were the KSB1 fixture until
 * ADR-0036, matched mostly on the cost centre, in the vendor line-item
 * layout and sign.
 */
export function fbl1nCostCentreSheet(): Sheet {
  return {
    header: [
      "Document Number",
      "Line Item",
      "Document Date",
      "Posting Date",
      "Amount in local currency",
      "Text",
      "Name 1",
      "WBS Element",
      "Cost Center",
      "G/L Account",
    ],
    rows: [
      ["4900001", "1", "31.01.2026", "31.01.2026", "40.000,00-", "Πιστοποίηση 1", FIXTURE_KEYS.vendor, FIXTURE_KEYS.wbsA, FIXTURE_KEYS.costCentre, "0802100"],
      ["4900002", "1", "28.02.2026", "28.02.2026", "-35.250,75", "Πιστοποίηση 2", FIXTURE_KEYS.vendor, FIXTURE_KEYS.wbsA, FIXTURE_KEYS.costCentre, "0802100"],
      ["4900003", "1", "31.03.2026", "31.03.2026", "-18.400,00", "Πιστοποίηση 1", "ΓΑΜΑ ΜΗΧΑΝΙΚΗ ΛΤΔ", FIXTURE_KEYS.wbsB, FIXTURE_KEYS.costCentre, "0802100"],
      ["4900004", "1", "31.03.2026", "31.03.2026", "-6.100,00", "Προμήθεια αναλωσίμων", "ΔΕΛΤΑ ΕΞΟΠΛΙΣΜΟΙ ΛΤΔ", "", FIXTURE_KEYS.costCentre, "0802200"],
      ["4900005", "1", "31.03.2026", "31.03.2026", "1.250,00", "Επιστροφή υλικών", "ΔΕΛΤΑ ΕΞΟΠΛΙΣΜΟΙ ΛΤΔ", "", FIXTURE_KEYS.costCentre, "0802200"],
      ["4900006", "1", "31.03.2026", "31.03.2026", "-4.800,00", "Διάφορες εργασίες", "ΕΨΙΛΟΝ ΥΠΗΡΕΣΙΕΣ ΛΤΔ", "", "CC9999", "0802200"],
      ["4900007", "1", "31.03.2026", "31.03.2026", "-2.900,00", "Εργασίες καθαρισμού", "ΖΗΤΑ ΧΡΩΜΑΤΑ ΛΤΔ", "", "CC9999", "0802200"],
      ["4900008", "1", "31.03.2026", "31.03.2026", "-2.100,00", "Εργασίες αποκατάστασης", "ΗΤΑ ΜΟΝΩΣΕΙΣ ΛΤΔ", "", "CC9999", "0802200"],
    ],
  };
}

/** The columns of `sap_capex_lineitem_export`, as SAP administration names them (23/11/2026). */
export const CAPEX_LINES_HEADER = [
  "companyCode",
  "fiscalYear",
  "period",
  "document",
  "item",
  "documentDate",
  "postingDate",
  "glAccount",
  "amount",
  "currency",
  "text",
  "assignment",
  "reference",
  "vendor",
  "costCentre",
  "contractReference",
];

/** One capital line, by the names above; what is left out is empty. */
export type CapexLine = Partial<Record<(typeof CAPEX_LINES_HEADER)[number], string>>;

export function capexLinesSheet(lines: CapexLine[]): Sheet {
  return {
    header: CAPEX_LINES_HEADER,
    rows: lines.map((line) => CAPEX_LINES_HEADER.map((column) => line[column] ?? "")),
  };
}

/**
 * CAPEX_LINES — the capital spending lines (ADR-0036). Six lines that show
 * every way the file arrives: ISO dates from the connector and dd.mm.yyyy
 * from a Greek client, a dot and a comma decimal, a credit note negative
 * (SAP sends debit positive, credit negative, and the profile keeps it), a
 * line with no text whose assignment stands in, a CAP- reference that names
 * no contract here, and a line with no reference at all.
 */
export function capexLinesFixture(): Sheet {
  const base = { companyCode: "1000", fiscalYear: "2026", period: "10", currency: "EUR", glAccount: "0802100" };
  return capexLinesSheet([
    { ...base, document: "5100000001", item: "1", documentDate: "2026-10-05", postingDate: "2026-10-06", amount: "12345.67", text: "Τιμολόγιο εργασιών 1", reference: "INV-001", vendor: "0000100201", costCentre: "CC1001", contractReference: "CAP-2026-9001" },
    { ...base, document: "5100000002", item: "1", documentDate: "07.10.2026", postingDate: "08.10.2026", amount: "1.000,50", text: "Τιμολόγιο εργασιών 2", reference: "INV-002", vendor: "100201", costCentre: "CC1001", contractReference: "" },
    { ...base, document: "5100000003", item: "2", documentDate: "2026-10-09", postingDate: "2026-10-09", amount: "-250.00", text: "Πιστωτικό σημείωμα 7", reference: "CN-007", vendor: "100202", costCentre: "", contractReference: "CAP-2026-9002" },
    { ...base, document: "5100000004", item: "1", documentDate: "2026-10-12", postingDate: "2026-10-13", amount: "800", text: "", assignment: "ΑΝΑΘ-44", reference: "INV-004", vendor: "100203", costCentre: "", contractReference: "" },
    { ...base, document: "5100000005", item: "1", documentDate: "13.10.2026", postingDate: "14.10.2026", amount: "-1.234,56", text: "Επιστροφή", reference: "CN-008", vendor: "100203", costCentre: "", contractReference: "" },
    { ...base, document: "5100000006", item: "1", documentDate: "2026-10-15", postingDate: "2026-10-15", amount: "4500", text: "Μελέτη", reference: "INV-006", vendor: "100204", costCentre: "", contractReference: "" },
  ]);
}

/** A sheet as a .csv, quoted where it has to be, with the delimiter given. */
export function csvOf(sheet: Sheet, delimiter: ";" | "," = ";"): Buffer {
  const cell = (value: string | number) => {
    const text = String(value);
    return text.includes(delimiter) || text.includes('"') || text.includes("\n")
      ? `"${text.replace(/"/g, '""')}"`
      : text;
  };
  const lines = [sheet.header, ...sheet.rows].map((row) => row.map(cell).join(delimiter));
  return Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8");
}

/** A sheet as an .xlsx, in memory. */
export async function xlsxOf(sheet: Sheet, name = "Sheet1"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital fixture builder";
  // A fixed timestamp, so rebuilding the fixture on another day does not show
  // up as a change to a file whose contents are the same.
  workbook.created = new Date("2026-04-01T00:00:00Z");
  workbook.modified = workbook.created;
  const worksheet = workbook.addWorksheet(name);
  worksheet.addRow(sheet.header);
  for (const row of sheet.rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * FBL1N — vendor line items. A vendor invoice is a credit on the vendor
 * account, so the amounts are negative in the file and the profile inverts
 * them; the credit note at the end is positive there and comes back negative
 * here, which is what «credits negative» means in the ledger.
 */
export function fbl1nSheet(): Sheet {
  return {
    header: [
      "Document Number",
      "Line Item",
      "Document Date",
      "Posting Date",
      "Amount in local currency",
      "Text",
      "Name 1",
      "WBS Element",
      "Purchasing Document",
      "G/L Account",
    ],
    rows: [
      ["1900001", "1", "15.01.2026", "31.01.2026", "-40.000,00", "Τιμολόγιο 4417", FIXTURE_KEYS.vendor, FIXTURE_KEYS.wbsA, "", "0802100"],
      ["1900002", "1", "15.02.2026", "28.02.2026", "-22.500,00", "Τιμολόγιο 4492", FIXTURE_KEYS.vendor, FIXTURE_KEYS.wbsA, "", "0802100"],
      ["1900003", "1", "15.03.2026", "31.03.2026", "-11.750,40", "Τιμολόγιο 118", "ΓΑΜΑ ΜΗΧΑΝΙΚΗ ΛΤΔ", "", FIXTURE_KEYS.purchaseOrder, "0802100"],
      ["1900004", "1", "20.03.2026", "31.03.2026", "3.200,00", "Πιστωτικό 12", "ΓΑΜΑ ΜΗΧΑΝΙΚΗ ΛΤΔ", "", FIXTURE_KEYS.purchaseOrder, "0802100"],
      ["1900005", "1", "22.03.2026", "31.03.2026", "-5.400,00", "Τιμολόγιο 908", "ΕΨΙΛΟΝ ΥΠΗΡΕΣΙΕΣ ΛΤΔ", "", "", "0802200"],
      ["1900006", "1", "23.03.2026", "31.03.2026", "-2.150,00", "Τιμολόγιο 909", "ΕΨΙΛΟΝ ΥΠΗΡΕΣΙΕΣ ΛΤΔ", "", "", "0802200"],
    ],
  };
}

export async function buildSapFixtures(dir: string = SAP_FIXTURE_DIR): Promise<string[]> {
  const files: [Sheet, string, string][] = [
    [fbl1nMatchingSheet(), join(dir, "fbl1n-matching.xlsx"), "FBL1N"],
    [fbl1nCostCentreSheet(), join(dir, "fbl1n-cost-centre.xlsx"), "FBL1N"],
    [fbl1nSheet(), join(dir, "fbl1n.xlsx"), "FBL1N"],
    [capexLinesFixture(), join(dir, "capexlines.xlsx"), "capexlines"],
  ];
  for (const [sheet, path, name] of files) writeFileSync(path, await xlsxOf(sheet, name));
  // The connector's own form: a comma-separated list.
  const csv = join(dir, "capexlines.csv");
  writeFileSync(csv, csvOf(capexLinesFixture(), ","));
  return [...files.map(([, path]) => path), csv];
}

if (require.main === module) {
  buildSapFixtures()
    .then((paths) => console.log(`sap fixtures: wrote ${paths.join(", ")}`))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
