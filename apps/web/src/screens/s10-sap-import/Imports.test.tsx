import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render";
import { Imports } from "./Imports";
import { buildImportBatch } from "./fixture";

const noPermission = <div>δεν έχετε πρόσβαση</div>;
const noop = () => undefined;

describe("Imports (S10)", () => {
  it("lists batches with their status label", () => {
    renderWithIntl(
      <Imports data={[buildImportBatch()]} state="default" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} />,
    );
    expect(document.body.textContent).toContain("Εκκρεμεί ανάθεση");
    expect(document.body.textContent).toContain("me2n-2026-09.csv");
  });

  // RULE: only finance/admin get the upload card (canImportSap).
  it("shows the upload card for finance", () => {
    renderWithIntl(<Imports data={[]} state="empty" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} />);
    expect(document.getElementById("s10-file")).toBeTruthy();
  });

  it("hides the upload card for a role that cannot import", () => {
    renderWithIntl(<Imports data={[]} state="empty" noPermission={noPermission} roles={["project_engineer"]} onRowOpen={noop} onUpload={noop} />);
    expect(document.getElementById("s10-file")).toBeNull();
  });

  it("fires onRowOpen with the clicked batch", () => {
    const onRowOpen = vi.fn();
    const batch = buildImportBatch();
    renderWithIntl(
      <Imports data={[batch]} state="default" noPermission={noPermission} roles={["finance"]} onRowOpen={onRowOpen} onUpload={noop} />,
    );
    const row = document.querySelector("tbody tr") as HTMLElement;
    row.focus();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onRowOpen).toHaveBeenCalledWith(batch);
  });

  it("shows the dry-run result panel with the matched/total sentence", () => {
    renderWithIntl(
      <Imports
        data={[]}
        state="empty"
        noPermission={noPermission}
        roles={["finance"]}
        onRowOpen={noop}
        onUpload={noop}
        dryRunResult={{ matched: 265, total: 312, exceptions: ["Γραμμή 12: άγνωστο WBS"] }}
      />,
    );
    expect(document.body.textContent).toContain("265");
    expect(document.body.textContent).toContain("312");
    expect(document.body.textContent).toContain("Γραμμή 12: άγνωστο WBS");
  });

  it("returns just the noPermission node for the noPermission state", () => {
    renderWithIntl(<Imports state="noPermission" noPermission={noPermission} onRowOpen={noop} onUpload={noop} />);
    expect(document.body.textContent).toBe("δεν έχετε πρόσβαση");
  });
});
