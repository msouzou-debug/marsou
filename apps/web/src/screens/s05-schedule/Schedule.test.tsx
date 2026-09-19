import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Milestone, ProjectDetail } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { Schedule } from "./Schedule";
import { deviationDays, milestoneStatus } from "./milestone-status";

const noPermission = <div data-testid="no-permission-stub" />;
const today = new Date("2026-09-18T00:00:00.000Z");

function milestone(overrides: Partial<Parameters<typeof Milestone.parse>[0]> = {}) {
  return Milestone.parse({
    id: "MS-1",
    projectId: "PRJ-1",
    titleEl: "Υπογραφή σύμβασης",
    baselineDate: "2026-06-01",
    forecastDate: null,
    actualDate: null,
    isGate: false,
    sortOrder: 0,
    ...overrides,
  });
}

function detailWith(milestones: ReturnType<typeof milestone>[]): ProjectDetail {
  return ProjectDetail.parse({
    id: "PRJ-1",
    code: "NGH-2026-001",
    orgUnitId: "nicosia-general",
    titleEl: "Ανακαίνιση χειρουργείων",
    category: "RENOVATION",
    phase: "IN_PROGRESS",
    approvedBudget: 2_000_000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-01-01",
    plannedFinish: "2026-12-01",
    rag: "AMBER",
    ragReason: "—",
    sapWbs: null,
    tenderReference: null,
    ledgers: { approved: 2_000_000, committed: null, spent: null, forecast: null },
    orgUnit: { id: "nicosia-general", nameEl: "Γενικό Νοσοκομείο Λευκωσίας", nameEn: "Nicosia General Hospital" },
    sponsorName: null,
    projectManagerName: null,
    milestones,
    risks: [],
    issues: [],
    audit: [],
  });
}

describe("milestone-status helpers", () => {
  it("computes a positive deviation only when the forecast is past the baseline", () => {
    expect(deviationDays(milestone({ forecastDate: "2026-06-10", baselineDate: "2026-06-01" }))).toBe(9);
    expect(deviationDays(milestone({ forecastDate: "2026-05-28", baselineDate: "2026-06-01" }))).toBe(-4);
    expect(deviationDays(milestone({ forecastDate: null }))).toBeNull();
  });

  it("derives Εκκρεμεί / Σε καθυστέρηση / Ολοκληρώθηκε from the dates alone", () => {
    expect(milestoneStatus(milestone({ forecastDate: null, actualDate: null }))).toBe("PENDING");
    expect(milestoneStatus(milestone({ baselineDate: "2026-06-01", forecastDate: "2026-06-10", actualDate: null }))).toBe(
      "DELAYED",
    );
    expect(milestoneStatus(milestone({ baselineDate: "2026-06-01", forecastDate: "2026-06-10", actualDate: "2026-06-12" }))).toBe(
      "DONE",
    );
  });
});

describe("Schedule table", () => {
  it("never opens the inline editor on the baseline column", async () => {
    const onCellEdit = vi.fn();
    renderWithIntl(
      <Schedule data={detailWith([milestone()])} state="default" noPermission={noPermission} today={today} roles={["estates_head"]} onCellEdit={onCellEdit} />,
    );

    await userEvent.dblClick(screen.getByText("01/06/2026"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("calls onCellEdit with the new forecast date on Enter", async () => {
    const onCellEdit = vi.fn();
    renderWithIntl(
      <Schedule
        data={detailWith([milestone({ forecastDate: "2026-06-05" })])}
        state="default"
        noPermission={noPermission}
        today={today}
        roles={["estates_head"]}
        onCellEdit={onCellEdit}
      />,
    );

    await userEvent.dblClick(screen.getByText("05/06/2026"));
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "2026-06-20{Enter}");

    expect(onCellEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "MS-1" }), "forecast", "2026-06-20");
  });

  it("marks the gate icon with visible text, not colour alone", () => {
    renderWithIntl(
      <Schedule data={detailWith([milestone({ isGate: true })])} state="default" noPermission={noPermission} today={today} />,
    );
    expect(within(screen.getByRole("table")).getByText("Πύλη φάσης")).toBeInTheDocument();
  });

  it("marks the deviation red only when it is positive", () => {
    renderWithIntl(
      <Schedule
        data={detailWith([
          milestone({ id: "MS-late", baselineDate: "2026-06-01", forecastDate: "2026-06-10" }),
          milestone({ id: "MS-early", baselineDate: "2026-06-01", forecastDate: "2026-05-28" }),
        ])}
        state="default"
        noPermission={noPermission}
        today={today}
      />,
    );

    const lateCell = screen.getByText("9 ημ");
    expect(lateCell.closest("span")).toHaveClass("text-k-red");
    const earlyCell = screen.getByText("-4 ημ");
    expect(earlyCell.closest("span")).toHaveClass("text-k-ink");
  });

  it("renders a baselineFixed-style error banner when the API refuses a cell edit", () => {
    renderWithIntl(
      <Schedule
        data={detailWith([milestone()])}
        state="default"
        noPermission={noPermission}
        today={today}
        cellApiError="Η ημερομηνία βάσης δεν μπορεί να αλλάξει."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Η ημερομηνία βάσης δεν μπορεί να αλλάξει.");
  });

  it("shows the empty sentence and a Προσθήκη action when there are no milestones", () => {
    renderWithIntl(
      <Schedule data={detailWith([])} state="default" noPermission={noPermission} today={today} roles={["estates_head"]} />,
    );
    expect(screen.getByText("Δεν έχουν οριστεί ορόσημα για αυτό το έργο.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Προσθήκη" }).length).toBeGreaterThan(0);
  });

  it("renders NoPermission for the 404-as-RLS state", () => {
    renderWithIntl(<Schedule data={undefined} state="noPermission" noPermission={noPermission} />);
    expect(screen.getByTestId("no-permission-stub")).toBeInTheDocument();
  });
});
