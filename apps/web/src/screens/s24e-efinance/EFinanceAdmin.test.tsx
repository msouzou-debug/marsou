import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { buildEFinanceMasterSyncResult, buildEFinanceSyncResult } from "@/mocks/efinance";
import { EFinanceAdmin } from "./EFinanceAdmin";

describe("EFinanceAdmin", () => {
  it("has the two buttons and calls the matching handler", () => {
    const onSync = vi.fn();
    const onSyncMaster = vi.fn();
    renderWithIntl(<EFinanceAdmin onSync={onSync} onSyncMaster={onSyncMaster} />);
    fireEvent.click(screen.getByRole("button", { name: "Συγχρονισμός τώρα" }));
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSyncMaster).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Βασικά δεδομένα" }));
    expect(onSyncMaster).toHaveBeenCalledTimes(1);
  });

  it("keeps one filled blue button: «Συγχρονισμός τώρα»", () => {
    renderWithIntl(<EFinanceAdmin onSync={vi.fn()} onSyncMaster={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Συγχρονισμός τώρα" }).className).toContain("bg-k-blue");
    expect(screen.getByRole("button", { name: "Βασικά δεδομένα" }).className).not.toContain("bg-k-blue");
  });

  it("says plainly that no run has been made from this page yet", () => {
    renderWithIntl(<EFinanceAdmin onSync={vi.fn()} onSyncMaster={vi.fn()} />);
    expect(screen.getByText(/Δεν έχετε εκτελέσει συγχρονισμό σε αυτή τη συνεδρία/)).toBeInTheDocument();
  });

  it("shows the counts of the last sync, with its time", () => {
    renderWithIntl(<EFinanceAdmin onSync={vi.fn()} onSyncMaster={vi.fn()} syncResult={buildEFinanceSyncResult()} />);
    expect(screen.getByTestId("sync-invoices")).toHaveTextContent("12");
    expect(screen.getByTestId("sync-requisitions")).toHaveTextContent("3");
    expect(screen.getByTestId("sync-contracts")).toHaveTextContent("7");
    // 06:45 UTC is 09:45 in Nicosia.
    expect(screen.getByText(/Τιμολόγια και αιτήματα, 02\/10\/2026\s09:45/)).toBeInTheDocument();
  });

  it("shows the counts of the last master-data run", () => {
    renderWithIntl(<EFinanceAdmin onSync={vi.fn()} onSyncMaster={vi.fn()} masterResult={buildEFinanceMasterSyncResult()} />);
    expect(screen.getByTestId("master-units")).toHaveTextContent("11");
    expect(screen.getByTestId("master-upserted")).toHaveTextContent("240");
    expect(screen.getByTestId("master-deactivated")).toHaveTextContent("2");
  });

  it("says nothing was read when eFinance is not configured", () => {
    renderWithIntl(
      <EFinanceAdmin
        onSync={vi.fn()}
        onSyncMaster={vi.fn()}
        syncResult={buildEFinanceSyncResult({ configured: false, contractsRefreshed: 0 })}
        masterResult={buildEFinanceMasterSyncResult({ configured: false })}
      />,
    );
    expect(screen.getAllByText("Το eFinance δεν έχει ρυθμιστεί σε αυτό το περιβάλλον. Δεν διαβάστηκε τίποτα.")).toHaveLength(2);
    expect(screen.queryByTestId("sync-invoices")).not.toBeInTheDocument();
  });

  it("shows a feed's error and a failed call as alerts", () => {
    renderWithIntl(
      <EFinanceAdmin
        onSync={vi.fn()}
        onSyncMaster={vi.fn()}
        syncResult={buildEFinanceSyncResult({ requisitions: { rows: 0, cursor: null, error: "TIMEOUT" } })}
        masterError="Το eFinance δεν απάντησε."
      />,
    );
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toContain("Σφάλμα ανάγνωσης (Αιτήματα): TIMEOUT");
    expect(alerts).toContain("Το eFinance δεν απάντησε.");
  });

  it("disables both buttons while a run is in flight and while offline", () => {
    const { unmount } = renderWithIntl(<EFinanceAdmin onSync={vi.fn()} onSyncMaster={vi.fn()} syncing />);
    expect(screen.getByRole("button", { name: "Συγχρονισμός τώρα" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Βασικά δεδομένα" })).toBeDisabled();
    unmount();
    renderWithIntl(<EFinanceAdmin onSync={vi.fn()} onSyncMaster={vi.fn()} offline />);
    expect(screen.getByRole("button", { name: "Συγχρονισμός τώρα" })).toBeDisabled();
  });
});
