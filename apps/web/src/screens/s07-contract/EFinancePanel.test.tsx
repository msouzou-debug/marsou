import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildEFinanceSummary } from "@/mocks/efinance";
import { EFinancePanel, isConflictError } from "./EFinancePanel";

const eur = (value: number) => formatEUR(value).replace(/\s/g, " ");

describe("EFinancePanel — not configured", () => {
  it("shows one quiet line and no panel when efinance is null", () => {
    renderWithIntl(<EFinancePanel efinance={null} canPush />);
    expect(screen.getByText("Δεν έχει ρυθμιστεί η σύνδεση με το eFinance")).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    // Nothing to push to, so not even an admin gets the button.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("treats an absent efinance (a fixture older than ADR-0029) the same way", () => {
    renderWithIntl(<EFinancePanel efinance={undefined} />);
    expect(screen.getByTestId("efinance-not-configured")).toBeInTheDocument();
  });

  it("says the same in English", () => {
    renderWithIntl(<EFinancePanel efinance={null} />, { locale: "en" });
    expect(screen.getByText("eFinance link not configured")).toBeInTheDocument();
  });
});

describe("EFinancePanel — the four figures", () => {
  it("renders booked, in flight, requisitions and remaining with the glossary labels", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary()} />);
    expect(screen.getByText("Δαπάνες")).toBeInTheDocument();
    expect(screen.getByText("Σε εξέλιξη")).toBeInTheDocument();
    expect(screen.getByText("Δεσμεύσεις eFinance")).toBeInTheDocument();
    expect(screen.getByText("Υπόλοιπο")).toBeInTheDocument();
    expect(screen.getByTestId("efinance-booked")).toHaveTextContent(eur(480_000));
    expect(screen.getByTestId("efinance-in-flight")).toHaveTextContent(eur(96_000));
    expect(screen.getByTestId("efinance-requisitions")).toHaveTextContent(eur(240_000));
    expect(screen.getByTestId("efinance-remaining")).toHaveTextContent(eur(1_680_000));
  });

  // RULE (ADR-0021 §7): null is never zero.
  it("renders every null figure as a dash, never as 0", () => {
    const summary = buildEFinanceSummary({ booked: null, inFlight: null, requisitions: null, remaining: null });
    renderWithIntl(<EFinancePanel efinance={summary} />);
    for (const id of ["efinance-booked", "efinance-in-flight", "efinance-requisitions", "efinance-remaining"]) {
      expect(screen.getByTestId(id)).toHaveTextContent(/^—$/);
    }
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  it("keeps a genuine zero as a zero, distinct from null", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary({ booked: 0 })} />);
    expect(screen.getByTestId("efinance-booked")).toHaveTextContent(eur(0));
  });

  // RULE (record §3): in flight is forecast only — marked in words, and the
  // only figure that carries the note.
  it("marks «Σε εξέλιξη» as not counted, in words", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary()} />);
    expect(screen.getAllByText("Δεν προσμετράται")).toHaveLength(1);
    const inFlight = screen.getByText("Σε εξέλιξη").parentElement;
    expect(inFlight).toHaveTextContent("Δεν προσμετράται");
  });

  it("shows a negative remaining in red", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary({ remaining: -12_000 })} />);
    expect(screen.getByTestId("efinance-remaining").querySelector("span")).toHaveClass("text-k-red");
  });

  it("dates the figures with the last sync, dd/mm/yyyy HH:mm", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary({ lastSyncAt: "2026-10-01T06:00:00.000Z" })} />);
    // 06:00 UTC is 09:00 in Nicosia (EEST).
    expect(screen.getByText(/Στοιχεία eFinance έως 01\/10\/2026\s09:00/)).toBeInTheDocument();
  });
});

describe("EFinancePanel — push state", () => {
  it("says when the contract was sent", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary({ pushedAt: "2026-09-30T08:15:00.000Z" })} />);
    expect(screen.getByTestId("efinance-push-state")).toHaveTextContent(/Στάλθηκε στο eFinance στις 30\/09\/2026\s11:15/);
  });

  it("says «Δεν έχει σταλεί» when it never was", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary({ pushedAt: null })} />);
    expect(screen.getByText("Δεν έχει σταλεί")).toBeInTheDocument();
  });

  it("explains a conflict instead of printing the raw code", () => {
    const conflict = "CONFLICT: cap_ref CAP-2026-0031 exists under entity NIC";
    expect(isConflictError(conflict)).toBe(true);
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary({ lastError: conflict })} />);
    const state = screen.getByTestId("efinance-push-state");
    expect(state).toHaveTextContent("Το eFinance έχει τη σύμβαση σε άλλη Μονάδα ή κωδικό προϋπολογισμού");
    // eFinance's own words stay available, without the CONFLICT prefix.
    expect(state).toHaveTextContent("cap_ref CAP-2026-0031 exists under entity NIC");
    expect(state).not.toHaveTextContent("CONFLICT:");
  });

  it("shows any other error text as it is", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary({ lastError: "TIMEOUT: δεν υπήρξε απάντηση" })} />);
    expect(screen.getByTestId("efinance-push-state")).toHaveTextContent("Η τελευταία αποστολή απέτυχε: TIMEOUT: δεν υπήρξε απάντηση");
  });
});

describe("EFinancePanel — the push button", () => {
  it("is not offered to anyone but an admin", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary()} canPush={false} />);
    expect(screen.queryByRole("button", { name: "Αποστολή στο eFinance" })).not.toBeInTheDocument();
  });

  it("calls onPush, and is a secondary button (one filled blue per view)", () => {
    const onPush = vi.fn();
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary()} canPush onPush={onPush} />);
    const button = screen.getByRole("button", { name: "Αποστολή στο eFinance" });
    expect(button.className).not.toContain("bg-k-blue");
    fireEvent.click(button);
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it("is disabled while pushing and while offline", () => {
    const { unmount } = renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary()} canPush pushing />);
    expect(screen.getByRole("button", { name: "Αποστολή στο eFinance" })).toBeDisabled();
    unmount();
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary()} canPush offline />);
    expect(screen.getByRole("button", { name: "Αποστολή στο eFinance" })).toBeDisabled();
  });

  it("shows a successful push inline", () => {
    renderWithIntl(<EFinancePanel efinance={buildEFinanceSummary()} canPush pushResult={{ ok: true }} />);
    expect(screen.getByTestId("efinance-push-result")).toHaveTextContent("Η σύμβαση στάλθηκε στο eFinance.");
  });

  it("shows the error text of a failed push inline, as an alert", () => {
    renderWithIntl(
      <EFinancePanel
        efinance={buildEFinanceSummary()}
        canPush
        pushResult={{ ok: false, message: "Η σύμβαση δεν έχει κωδικό προϋπολογισμού και δεν μπορεί να σταλεί στο eFinance." }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("δεν έχει κωδικό προϋπολογισμού");
  });

  it("explains a conflict that came back from a push", () => {
    renderWithIntl(
      <EFinancePanel efinance={buildEFinanceSummary()} canPush pushResult={{ ok: false, message: "CONFLICT: entity NIC" }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("άλλη Μονάδα ή κωδικό προϋπολογισμού");
  });
});
