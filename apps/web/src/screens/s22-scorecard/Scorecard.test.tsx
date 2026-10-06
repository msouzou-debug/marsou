import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatPct } from "@/lib/format";
import { buildMaintenanceContract, buildScorecard } from "@/mocks/maintenance";
import { nicosiaToday, quarter, shiftDay } from "./period";
import { Scorecard, type ScorecardProps } from "./Scorecard";
import { scorecardExportHref } from "./ScorecardScreen";

const TODAY = "2026-10-06";

function renderCard(overrides: Partial<ScorecardProps> = {}) {
  const props: ScorecardProps = {
    agreements: [buildMaintenanceContract()],
    agreementId: "mc-1",
    onAgreement: vi.fn(),
    period: quarter(TODAY, -1),
    onPeriod: vi.fn(),
    today: TODAY,
    scorecard: buildScorecard(),
    state: "default",
    onExport: vi.fn(),
    noPermission: <p>no-permission-marker</p>,
    ...overrides,
  };
  renderWithIntl(<Scorecard {...props} />);
  return props;
}

const exact = (text: string) => (_: string, el: Element | null) => el?.textContent === text;

describe("S22 Scorecard", () => {
  it("shows the on-time ratios with their counts", () => {
    renderCard();
    const tile = screen.getByText("Ανταπόκριση εντός χρόνου", { selector: "p" }).parentElement!;
    expect(within(tile).getByText(exact(formatPct(91.7)), { selector: "p" })).toBeInTheDocument();
    expect(within(tile).getByText("44 από 48")).toBeInTheDocument();
  });

  // RULE (ADR-0031 §2): penalties with a missing rate are counted, not priced — and the screen says so.
  it("says «ρήτρες ελλιπείς» when catalogue rates are missing", () => {
    renderCard();
    expect(screen.getByText("ρήτρες ελλιπείς")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Οι ρήτρες είναι ελλιπείς");
  });

  it("drops the note when every rate is known", () => {
    const sc = buildScorecard();
    renderCard({ scorecard: { ...sc, penalties: { ...sc.penalties, ratesMissing: false, totalEur: 1200, responseEur: 1200 } } });
    expect(screen.queryByText("ρήτρες ελλιπείς")).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByText("με όλες τις ρήτρες")).toBeInTheDocument();
  });

  it("shows «—» for a ratio with nothing due, never 0 %", () => {
    const sc = buildScorecard();
    renderCard({ scorecard: { ...sc, report: { due: 0, onTime: 0, pct: null } } });
    const tile = screen.getByText("Εκθέσεις εντός χρόνου", { selector: "p" }).parentElement!;
    expect(within(tile).getByText("—")).toBeInTheDocument();
  });

  it("lists the bands in a table with the downtime hours", () => {
    renderCard();
    const table = screen.getByRole("table", { name: "Ανά ζώνη προτεραιότητας" });
    const row = within(table).getByText("Κρίσιμης λειτουργίας").closest("tr")!;
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("14 ω")).toBeInTheDocument();
  });

  it("says when the agreement has no value to measure the cap against", () => {
    const sc = buildScorecard();
    renderCard({ scorecard: { ...sc, penalties: { ...sc.penalties, capUsedPct: null } } });
    expect(screen.getByText("Η σύμβαση δεν έχει καταχωρισμένη αξία.")).toBeInTheDocument();
  });

  it("offers the two quarter presets and marks the one in use", () => {
    const props = renderCard();
    expect(screen.getByRole("button", { name: "Προηγούμενο τρίμηνο" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Τρέχον τρίμηνο" }));
    expect(props.onPeriod).toHaveBeenCalledWith({ from: "2026-10-01", to: "2027-01-01" });
  });

  it("downloads the Excel from the table's export button", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Εξαγωγή σε Excel/ }));
    expect(props.onExport).toHaveBeenCalled();
    expect(scorecardExportHref({ maintenanceContractId: "mc-1", from: "2026-07-01", to: "2026-10-01" })).toBe(
      "/api/proxy/maintenance/scorecard.xlsx?maintenanceContractId=mc-1&from=2026-07-01&to=2026-10-01",
    );
  });

  it("asks for an agreement first", () => {
    renderCard({ agreementId: "", state: "idle", scorecard: undefined });
    expect(screen.getByText("Επιλέξτε σύμβαση για να δείτε την αξιολόγηση.")).toBeInTheDocument();
  });

  it("renders noPermission", () => {
    renderCard({ state: "noPermission" });
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });
});

describe("S22 period", () => {
  it("finds the current and previous quarter, across a year end", () => {
    expect(quarter("2026-10-06", 0)).toEqual({ from: "2026-10-01", to: "2027-01-01" });
    expect(quarter("2026-10-06", -1)).toEqual({ from: "2026-07-01", to: "2026-10-01" });
    expect(quarter("2026-02-10", -1)).toEqual({ from: "2025-10-01", to: "2026-01-01" });
  });

  it("shows an exclusive end as the inclusive last day and back", () => {
    expect(shiftDay("2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("reads today in Nicosia time", () => {
    // 22:30 UTC on 30/09 is already 01/10 in Nicosia (UTC+3 in summer).
    expect(nicosiaToday(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01");
  });
});
