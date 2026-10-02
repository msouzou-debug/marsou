import type { EFinanceRawInvoice } from "@ecapital/shared";
import { describe, expect, it } from "vitest";
import { isoUtc, toAmount, toMoneyString } from "./efinance-client";
import { budgetPositionOf, isConflict, projectSummaryOf, projectedLines, summaryOf } from "./efinance-rows";

const invoice = (ledger: EFinanceRawInvoice["ledger"], overrides: Partial<EFinanceRawInvoice> = {}): EFinanceRawInvoice => ({
  id: "77",
  invoice_no: "INV-77",
  invoice_date: "2026-06-30",
  sap_batch_date: "2026-09-15",
  vendor_code: "100123",
  vendor_name: "Άλφα",
  entity_code: "NGH",
  currency: "EUR",
  net: "300.00",
  vat: "57.00",
  gross: "357.00",
  status: "approved",
  ledger,
  cap_ref: "CAP-2026-0001",
  reversed_at: null,
  reversal_sap_doc_no: null,
  reversal_reason: null,
  updated_at: "2026-09-15T08:00:00+00:00",
  lines: [
    { descr: "α", qty: "1", unit_price: "100.00", line_total: "100.00", vat_rate: "19", gl_account: "G", cost_centre: "C1", budget_code: "7402", wbs_code: "W" },
    { descr: "β", qty: "1", unit_price: null, line_total: null, vat_rate: null, gl_account: null, cost_centre: null, budget_code: null, wbs_code: null },
    { descr: "γ", qty: "2", unit_price: "100.00", line_total: "200.00", vat_rate: "19", gl_account: "G", cost_centre: "C2", budget_code: "7402", wbs_code: null },
  ],
  ...overrides,
});

describe("projectedLines (ADR-0029)", () => {
  it("posts a booked invoice line by line, from the lines and never the header, on the SAP batch date", () => {
    const lines = projectedLines(invoice("booked"));
    expect(lines.map((line) => [line.sourceRef, line.amount, line.postingDate, line.docDate])).toEqual([
      ["efinance:invoice:77:0", "100.00", "2026-09-15", "2026-06-30"],
      ["efinance:invoice:77:2", "200.00", "2026-09-15", "2026-06-30"],
    ]);
  });

  it("posts nothing for in flight, reversed, rejected, or a currency the ledger does not hold", () => {
    for (const ledger of ["in_flight", "reversed", "rejected"] as const) {
      expect(projectedLines(invoice(ledger))).toEqual([]);
    }
    expect(projectedLines(invoice("booked", { currency: "USD" }))).toEqual([]);
  });
});

describe("the eFinance figures", () => {
  it("are null where eFinance has not answered, never zero", () => {
    expect(summaryOf({ pushedAt: null, lastError: null, spend: null })).toEqual({
      pushedAt: null,
      lastError: null,
      booked: null,
      inFlight: null,
      requisitions: null,
      remaining: null,
      lastSyncAt: null,
    });
    const spend = { current_value: "10.00", booked: "1.50", in_flight: null, requisitions: "2.00", remaining: "6.50", fetched_at: "2026-10-02T08:00:00+00:00" };
    const project = projectSummaryOf([
      { pushedAt: "2026-10-01T00:00:00Z", lastError: null, spend },
      { pushedAt: null, lastError: "CONFLICT: moved", spend: null },
      { pushedAt: "2026-10-02T00:00:00Z", lastError: null, spend: { ...spend, booked: "3.25" } },
    ]);
    expect(project.booked).toBe(4.75);
    expect(project.inFlight).toBeNull();
    expect(project.pushedAt).toBe("2026-10-02T00:00:00.000Z");
    expect(project.lastError).toBe("CONFLICT: moved");
    expect(isConflict(project.lastError)).toBe(true);
    expect(isConflict("TIMEOUT: no answer")).toBe(false);
  });

  it("map the budget position as INTEGRATION §5 says, summing rows and keeping nulls", () => {
    const row = { budget_code: "7402", entity_code: "PAP", archive_code: "PAF", year: 2026, allocated: "100.00", booked: "10.00", in_flight: "5.00", requisitions: "20.00", available: "70.00" };
    const key = { budgetCode: "7402", entityCode: "PAF", year: 2026 };
    expect(budgetPositionOf([row], "2026-10-02T08:00:00+00:00", key)).toEqual({
      ...key, allocated: 100, booked: 10, requisitions: 20, inFlight: 5, available: 70, asOf: "2026-10-02T08:00:00+00:00",
    });
    const empty = budgetPositionOf([], null, key);
    expect([empty.allocated, empty.available, empty.inFlight]).toEqual([null, null, null]);
  });

  it("speak the record's money and time at the edge", () => {
    expect(toMoneyString("1250000")).toBe("1250000.00");
    expect(toMoneyString(0.1 + 0.2)).toBe("0.30");
    expect(toAmount("-12.50")).toBe(-12.5);
    expect(toAmount(null)).toBeNull();
    expect(isoUtc(new Date("2026-09-20T08:00:00.123Z"))).toBe("2026-09-20T08:00:00+00:00");
  });
});
