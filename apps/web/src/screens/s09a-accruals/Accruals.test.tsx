import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { Accruals } from "./Accruals";
import { buildAccrualRow } from "./fixture";

const noPermission = <div>δεν έχετε πρόσβαση</div>;
const noop = () => undefined;

describe("Accruals (S09a)", () => {
  it("shows the totals footer as the sum of certifiedNet/invoiced/accrual", () => {
    const rows = [
      buildAccrualRow({ certifiedNet: 100, invoiced: 60, accrual: 40 }),
      buildAccrualRow({ contractId: "c-2", certNumber: 1, certifiedNet: 200, invoiced: 150, accrual: 50 }),
    ];
    renderWithIntl(<Accruals data={rows} year={2026} onYearChange={noop} state="default" noPermission={noPermission} onExport={noop} />);
    const footer = document.querySelector(".border-t-2.border-k-ink");
    expect(footer?.textContent).toContain(formatEUR(300));
    expect(footer?.textContent).toContain(formatEUR(210));
    expect(footer?.textContent).toContain(formatEUR(90));
  });

  it("the export button is always rendered and disabled while loading", () => {
    renderWithIntl(<Accruals year={2026} onYearChange={noop} state="loading" noPermission={noPermission} onExport={noop} />);
    const exportButton = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Εξαγωγή σε Excel"));
    expect(exportButton).toBeTruthy();
    expect(exportButton?.hasAttribute("disabled")).toBe(true);
  });

  it("fires onYearChange when the year select changes", () => {
    const onYearChange = vi.fn();
    renderWithIntl(<Accruals data={[]} year={2026} onYearChange={onYearChange} state="empty" noPermission={noPermission} onExport={noop} />);
    const select = document.querySelector("select") as HTMLSelectElement;
    select.value = "2025";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onYearChange).toHaveBeenCalledWith(2025);
  });

  // RULE (screenshot review 19/09/2026, R18): invoiced above certified is
  // over-invoicing, not a negative accrual — the row stays, reads 0,00 €,
  // and the note explains why.
  it("shows the amber over-invoiced note and a 0,00 € accrual for an over-invoiced row", () => {
    const rows = [buildAccrualRow({ certifiedNet: 100_000, invoiced: 170_550, accrual: 0, overInvoiced: true })];
    renderWithIntl(<Accruals data={rows} year={2026} onYearChange={noop} state="default" noPermission={noPermission} onExport={noop} />);
    const row = document.querySelector("tbody tr");
    expect(row?.textContent).toContain(formatEUR(0));
    expect(row?.textContent).toContain("Τιμολογημένα πάνω από τα πιστοποιημένα");
  });

  it("shows no over-invoiced note for a normal accrual row", () => {
    const rows = [buildAccrualRow({ certifiedNet: 480_000, invoiced: 420_000, accrual: 60_000, overInvoiced: false })];
    renderWithIntl(<Accruals data={rows} year={2026} onYearChange={noop} state="default" noPermission={noPermission} onExport={noop} />);
    const row = document.querySelector("tbody tr");
    expect(row?.textContent).not.toContain("Τιμολογημένα πάνω από τα πιστοποιημένα");
  });

  it("returns just the noPermission node for the noPermission state", () => {
    renderWithIntl(<Accruals year={2026} onYearChange={noop} state="noPermission" noPermission={noPermission} onExport={noop} />);
    expect(document.body.textContent).toBe("δεν έχετε πρόσβαση");
  });
});
