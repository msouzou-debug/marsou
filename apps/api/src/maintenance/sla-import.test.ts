import { describe, expect, it } from "vitest";
import {
  SLA_COLUMNS,
  cellValue,
  parseBand,
  parseFrequencies,
  parseSlaSheet,
  templateRow,
  type SheetRowInput,
} from "./sla-import";

/**
 * R32, the importer's rules. The two that carry weight: columns are found by
 * header, never by position, and a cell that is not a number where a number
 * belongs is an error row — never a zero (the capex importer's rule,
 * CAPEX-03 §2).
 */
const HEADER = SLA_COLUMNS.map((c) => c.header);

function sheet(...rows: unknown[][]): SheetRowInput[] {
  return rows.map((values, index) => ({ rowNo: index + 1, values }));
}

describe("parseSlaSheet", () => {
  it("reads the contract's own row: band, hours, Greek frequencies, no rates", () => {
    const parsed = parseSlaSheet(
      sheet(HEADER, [
        "1.1.1",
        "Σύστημα Κλιματισμού σε όλα τα Χειρουργεία",
        "Κρίσιμο",
        0.5,
        2,
        24,
        "Εξαμηνιαία, Μηνιαίοι",
        null,
        null,
        null,
      ]),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        row: 2,
        code: "1.1.1",
        nameEl: "Σύστημα Κλιματισμού σε όλα τα Χειρουργεία",
        band: "CRITICAL",
        responseHours: 0.5,
        restoreHours: 2,
        reportHours: 24,
        pmFrequencies: ["MONTHLY", "SEMIANNUAL"],
        penaltyPmPerDay: null,
        penaltyResponsePerHour: null,
        penaltyRestorePerHour: null,
      },
    ]);
  });

  it("finds the columns by header when they are in another order", () => {
    const parsed = parseSlaSheet(
      sheet(
        ["Ρήτρα αποκατάστασης (€/ώρα)", "Κατηγορία", "Κωδικός", "Έκθεση (ώρες)", "Σύστημα", "Αποκατάσταση (ώρες)", "Ανταπόκριση (ώρες)"],
        [20, "P1", "1.2.4", "48", "Συστήματα Πυρόσβεσης", "24", "0,5"],
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      code: "1.2.4",
      band: "P1",
      responseHours: 0.5,
      restoreHours: 24,
      reportHours: 48,
      pmFrequencies: [],
      penaltyRestorePerHour: 20,
      penaltyResponsePerHour: null,
    });
  });

  it("reports a bad band and non-numeric hours by row in Greek and still reads the rest", () => {
    const parsed = parseSlaSheet(
      sheet(
        HEADER,
        ["1.1.1", "Κλιματισμός", "Επείγον", 0.5, 2, 24],
        ["1.1.2", "Νερό", "Κρίσιμο", "μισή ώρα", 2, 24],
        ["1.1.3", "Ιατρικά αέρια", "Προτεραιότητας 1", 0.5, 24, 48],
      ),
    );
    expect(parsed.rows.map((r) => r.code)).toEqual(["1.1.3"]);
    expect(parsed.errors.map((e) => e.row)).toEqual([2, 3]);
    expect(parsed.errors[0].messageEl).toContain("«Επείγον» δεν αναγνωρίζεται");
    expect(parsed.errors[1].messageEl).toContain("«μισή ώρα» δεν είναι θετικός αριθμός ωρών");
    // UI rule: Greek sentences, no exclamation marks.
    for (const error of parsed.errors) expect(error.messageEl).not.toContain("!");
  });

  it("refuses a zero or negative time instead of storing it", () => {
    const parsed = parseSlaSheet(sheet(HEADER, ["9.9", "Δοκιμή", "P2", 0, 48, 72]));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
  });

  it("reports the second row of a code that appears twice", () => {
    const parsed = parseSlaSheet(
      sheet(HEADER, ["1.1.1", "Αέρας", "P1", 1, 2, 3], ["1.1.1", "Βάση", "P1", 1, 2, 3]),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toEqual([{ row: 3, messageEl: expect.stringContaining("προηγούμενη γραμμή") }]);
  });

  it("refuses a sheet whose header is missing a required column", () => {
    const parsed = parseSlaSheet(sheet(["Κωδικός", "Σύστημα"], ["1.1.1", "Αέρας"]));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0].messageEl).toContain("«Κατηγορία»");
  });

  it("skips blank rows and refuses a negative rate", () => {
    const parsed = parseSlaSheet(
      sheet(HEADER, [], ["1.1.1", "Αέρας", "P1", 1, 2, 3, "", -5]),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([{ row: 3, messageEl: expect.stringContaining("ρήτρα") }]);
  });
});

describe("bands and frequencies", () => {
  it("accepts the template's words, the contract's words and the enum names", () => {
    expect(parseBand("Κρίσιμο")).toBe("CRITICAL");
    expect(parseBand("Κρίσιμης Λειτουργίας")).toBe("CRITICAL");
    expect(parseBand("CRITICAL")).toBe("CRITICAL");
    expect(parseBand("Προτεραιότητα 1")).toBe("P1");
    expect(parseBand("Προτεραιότητας 2")).toBe("P2");
    expect(parseBand("p2")).toBe("P2");
    expect(parseBand("Υψηλή")).toBeNull();
  });

  it("never reads «Τριμηνιαία» as «Μηνιαία»", () => {
    expect(parseFrequencies("Τριμηνιαία")).toEqual(["QUARTERLY"]);
    expect(parseFrequencies("Ημερήσια; ετήσια")).toEqual(["DAILY", "ANNUAL"]);
    expect(parseFrequencies("MONTHLY, WEEKLY")).toEqual(["WEEKLY", "MONTHLY"]);
    expect(parseFrequencies("Τριμηνιαία, Τριμηνιαία")).toEqual(["QUARTERLY"]);
    expect(parseFrequencies("κάθε τόσο")).toBeNull();
    expect(parseFrequencies(null)).toEqual([]);
  });

  it("unwraps rich text and formula cells", () => {
    expect(cellValue({ richText: [{ text: "Κρί" }, { text: "σιμο" }] })).toBe("Κρίσιμο");
    expect(cellValue({ formula: "1/2", result: 0.5 })).toBe(0.5);
    expect(cellValue(null)).toBeNull();
  });
});

describe("the template round trip", () => {
  it("writes a line the parser reads back unchanged", () => {
    const system = {
      code: "2.2.5",
      nameEl: "Ηλεκτροπαραγωγά Ζεύγη",
      band: "P1" as const,
      responseHours: 0.5,
      restoreHours: 24,
      reportHours: 48,
      pmFrequencies: ["MONTHLY" as const],
      penaltyPmPerDay: 50,
      penaltyResponsePerHour: null,
      penaltyRestorePerHour: 12.5,
    };
    const parsed = parseSlaSheet(sheet(HEADER, templateRow(system)));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toEqual({ row: 2, ...system });
  });
});
