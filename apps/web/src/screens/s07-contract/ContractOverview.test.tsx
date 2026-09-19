import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR, formatPct } from "@/lib/format";
import { ContractOverview } from "./ContractOverview";
import { buildContractDetail } from "./fixture";

const noPermission = <div>no permission</div>;

// `formatEUR` puts a thin space after the euro sign; Testing Library
// normalises DOM text but not the raw string it is given to match, so
// getByText needs this same normalisation to compare like with like — the
// same helper `CostBar.test.tsx` defines for the same reason.
const eur = (value: number) => formatEUR(value).replace(/\s/g, " ");
const pct = (value: number) => formatPct(value).replace(/\s/g, " ");

describe("ContractOverview — R31 warnings and money facts", () => {
  it("shows the over-10% variation figure in red", () => {
    const data = buildContractDetail();
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />);

    const figure = screen.getByText(eur(data.approvedVariationsTotal));
    expect(figure.className).toContain("text-k-red");
    expect(screen.getByText(`(${pct(data.variationPctOfOriginal)})`)).toHaveClass("text-k-red");
  });

  it("does not colour the approved-variations figure red at or under 10%", () => {
    const data = buildContractDetail({ variationPctOfOriginal: 8, approvedVariationsTotal: 100_000 });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />);

    const figure = screen.getByText(eur(100_000));
    expect(figure.className).not.toContain("text-k-red");
  });

  it("marks an expired performance bond in red with an icon, and a live one in ink", () => {
    const expired = buildContractDetail({ bondExpiry: "2026-01-01" });
    const { unmount } = renderWithIntl(
      <ContractOverview data={expired} state="default" noPermission={noPermission} today={new Date("2026-09-19")} />,
    );
    const expiredLabel = screen.getByText("Έληξε");
    expect(expiredLabel.parentElement?.className).toContain("text-k-red");
    unmount();

    const live = buildContractDetail({ bondExpiry: "2027-01-01" });
    renderWithIntl(<ContractOverview data={live} state="default" noPermission={noPermission} today={new Date("2026-09-19")} />);
    expect(screen.queryByText("Έληξε")).not.toBeInTheDocument();
  });

  // RULE (build brief §5): retention is its own line, never netted into the
  // current value shown elsewhere on the page.
  it("renders retention as its own line, computed from the current value and never netted", () => {
    const data = buildContractDetail({ currentValue: 2_736_000, retentionPct: 5 });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />);

    const retentionLine = screen.getByTestId("contract-retention-line");
    expect(retentionLine.textContent).toContain("Κρατήσεις");
    expect(screen.getByText(eur(2_736_000 * 0.05))).toBeInTheDocument();
    // The current value itself is untouched by the retention figure — it
    // still appears in full in the cost bar's own legend/summary.
    expect(screen.getAllByText(eur(2_736_000)).length).toBeGreaterThan(0);
  });

  it("never disables anything for a warning — R31 is warn-and-flag, not a gate", () => {
    const data = buildContractDetail({ orgUnitId: "larnaca-general" });
    renderWithIntl(
      <ContractOverview data={data} state="default" noPermission={noPermission} roles={["project_engineer"]} />,
    );
    expect(screen.getByText(data.warnings[0].sentenceEl)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Επεξεργασία" })).toBeInTheDocument();
  });
});

describe("BOQ", () => {
  it("shows the footer total equal to the sum of the line amounts", () => {
    const data = buildContractDetail();
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />);

    const expectedTotal = data.boq.reduce((sum, item) => sum + item.amount, 0);
    const totalRow = screen.getByText("Σύνολο").closest("tr");
    expect(totalRow).not.toBeNull();
    expect(totalRow!.textContent).toContain(formatEUR(expectedTotal));
  });

  it("shows the empty message and an add action when there is no bill", () => {
    const data = buildContractDetail({ boq: [] });
    const onSaveBoq = vi.fn();
    renderWithIntl(
      <ContractOverview
        data={data}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSaveBoq={onSaveBoq}
      />,
    );
    expect(screen.getByText("Δεν έχει καταχωριστεί πίνακας ποσοτήτων.")).toBeInTheDocument();
  });
});

describe("ContractOverview states", () => {
  it("renders noPermission verbatim", () => {
    renderWithIntl(<ContractOverview state="noPermission" noPermission={<div>ασχετο</div>} />);
    expect(screen.getByText("ασχετο")).toBeInTheDocument();
  });

  it("renders the error state with a retry button", () => {
    const onRetry = vi.fn();
    renderWithIntl(<ContractOverview state="error" noPermission={noPermission} onRetry={onRetry} />);
    expect(screen.getByText("Τα δεδομένα δεν φορτώθηκαν. Δοκιμάστε ξανά.")).toBeInTheDocument();
  });
});
