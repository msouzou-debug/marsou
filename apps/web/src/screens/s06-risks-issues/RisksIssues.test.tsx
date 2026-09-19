import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { ProjectDetail } from "@ecapital/shared";
import type { z } from "zod";
import { renderWithIntl } from "@/test/render";
import { RisksIssues } from "./RisksIssues";

type RiskInput = z.input<typeof ProjectDetail>["risks"][number];
type IssueInput = z.input<typeof ProjectDetail>["issues"][number];

const noPermission = <div data-testid="no-permission-stub" />;
const today = new Date("2026-09-18T00:00:00.000Z");

function detailWith(risks: Array<Partial<RiskInput>>, issues: Array<Partial<IssueInput>> = []): ProjectDetail {
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
    milestones: [],
    risks: risks.map((r, i) => ({
      id: `RSK-${i}`,
      projectId: "PRJ-1",
      descriptionEl: "Καθυστέρηση υλικών",
      likelihood: 3,
      impact: 3,
      ownerId: null,
      ownerName: null,
      mitigationEl: null,
      status: "OPEN",
      ...r,
    })),
    issues: issues.map((i, index) => ({
      id: `ISS-${index}`,
      projectId: "PRJ-1",
      descriptionEl: "Καθυστέρηση αδειοδότησης",
      raisedById: "u1",
      raisedByName: "Α. Δημητρίου",
      dueDate: null,
      status: "OPEN",
      ...i,
    })),
    audit: [],
  });
}

describe("RiskMatrix", () => {
  it("carries the count and the band word in the cell aria-label, never colour alone", () => {
    renderWithIntl(
      <RisksIssues data={detailWith([{ likelihood: 4, impact: 5 }])} state="default" noPermission={noPermission} today={today} />,
    );
    expect(screen.getByRole("img", { name: "Πιθανότητα 4, επίπτωση 5: 1 κίνδυνος, υψηλή ζώνη" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Πιθανότητα 1, επίπτωση 1: 0 κίνδυνοι, χαμηλή ζώνη" })).toBeInTheDocument();
  });
});

describe("Risk register table", () => {
  it("truncates Μέτρα to one line but keeps the full text in the title", () => {
    const longMitigation = "Καθημερινή παρακολούθηση προμηθευτή και εβδομαδιαία αναφορά προόδου στην ομάδα έργου.";
    renderWithIntl(
      <RisksIssues data={detailWith([{ mitigationEl: longMitigation }])} state="default" noPermission={noPermission} today={today} />,
    );
    const cell = screen.getByTitle(longMitigation);
    expect(cell).toHaveClass("truncate");
  });

  it("shows the empty sentence when there are no risks", () => {
    renderWithIntl(<RisksIssues data={detailWith([])} state="default" noPermission={noPermission} today={today} />);
    expect(screen.getAllByText("Δεν έχουν καταχωριστεί κίνδυνοι για αυτό το έργο.").length).toBeGreaterThan(0);
  });
});

describe("Issue register table", () => {
  it("marks a past-due OPEN issue red with an icon, and leaves a resolved one alone", () => {
    renderWithIntl(
      <RisksIssues
        data={detailWith([], [
          { descriptionEl: "Ανοιχτό εκπρόθεσμο", dueDate: "2026-09-01", status: "OPEN" },
          { descriptionEl: "Επιλυμένο εκπρόθεσμο", dueDate: "2026-09-01", status: "RESOLVED" },
        ])}
        state="default"
        noPermission={noPermission}
        today={today}
      />,
    );

    const overdueDate = screen.getAllByText("01/09/2026")[0];
    expect(overdueDate.closest("span")).toHaveClass("text-k-red");
  });

  it("shows the empty sentence when there are no issues", () => {
    renderWithIntl(<RisksIssues data={detailWith([])} state="default" noPermission={noPermission} today={today} />);
    expect(screen.getAllByText("Δεν έχουν καταχωριστεί θέματα για αυτό το έργο.").length).toBeGreaterThan(0);
  });
});

describe("RisksIssues no permission", () => {
  it("renders the shell's NoPermission for the 404-as-RLS state", () => {
    renderWithIntl(<RisksIssues data={undefined} state="noPermission" noPermission={noPermission} />);
    expect(screen.getByTestId("no-permission-stub")).toBeInTheDocument();
  });
});
