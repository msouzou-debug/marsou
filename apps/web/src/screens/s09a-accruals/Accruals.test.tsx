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

  it("returns just the noPermission node for the noPermission state", () => {
    renderWithIntl(<Accruals year={2026} onYearChange={noop} state="noPermission" noPermission={noPermission} onExport={noop} />);
    expect(document.body.textContent).toBe("δεν έχετε πρόσβαση");
  });
});
