import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { ProjectDetail } from "@ecapital/shared";
import { z } from "zod";
import { ProjectOverview } from "./ProjectOverview";

const noPermission = <div data-testid="no-permission-stub" />;

const raw: z.input<typeof ProjectDetail> = {
  id: "PRJ-1",
  code: "NGH-001",
  orgUnitId: "nicosia-general",
  titleEl: "Ανακαίνιση χειρουργείων",
  category: "RENOVATION",
  phase: "IN_PROGRESS",
  approvedBudget: 2_000_000,
  fundingSource: "STATE_BUDGET",
  plannedStart: "2026-01-01",
  plannedFinish: "2026-12-01",
  rag: "AMBER",
  ragReason: "Οι δεσμεύσεις πλησιάζουν τον εγκεκριμένο προϋπολογισμό",
  sapWbs: "WBS-1",
  tenderReference: "TND-1",
  ledgers: { approved: 2_000_000, committed: 1_800_000, spent: 900_000, forecast: 2_050_000 },
  orgUnit: { id: "nicosia-general", nameEl: "Γενικό Νοσοκομείο Λευκωσίας", nameEn: "Nicosia General Hospital" },
  sponsorName: "Υπουργείο Υγείας",
  projectManagerName: "Μαρία Ιωάννου",
  milestones: [
    {
      id: "MS-1",
      projectId: "PRJ-1",
      titleEl: "Υπογραφή σύμβασης",
      baselineDate: "2026-02-01",
      forecastDate: "2026-02-10",
      actualDate: "2026-02-10",
      isGate: false,
      sortOrder: 0,
    },
    {
      id: "MS-2",
      projectId: "PRJ-1",
      titleEl: "Παράδοση κτιριακού κελύφους",
      baselineDate: "2026-05-01",
      // In the past relative to any "today" this test passes, with no actual
      // date — RULE (UI instructions §5): overdue.
      forecastDate: "2026-05-15",
      actualDate: null,
      isGate: true,
      sortOrder: 1,
    },
  ],
  risks: [
    { id: "RSK-1", projectId: "PRJ-1", descriptionEl: "Καθυστέρηση υλικών", likelihood: 4, impact: 5, ownerId: null, ownerName: "Α. Δημητρίου", mitigationEl: null, status: "OPEN" },
  ],
  issues: [],
  audit: [
    { id: "AUD-1", actorName: "Μ. Ιωάννου", action: "created", at: "2025-01-01T09:00:00.000Z", detail: null },
  ],
};

const detail = ProjectDetail.parse(raw);
const today = new Date("2026-09-18T00:00:00.000Z");

describe("ProjectOverview milestones", () => {
  it("marks the gate milestone and the overdue one, never colour alone", () => {
    renderWithIntl(<ProjectOverview data={detail} state="default" noPermission={noPermission} today={today} />);

    expect(screen.getByTitle("Πύλη φάσης")).toBeInTheDocument();
    // The overdue label carries a text word, not only a colour.
    expect(screen.getByText("Εκπρόθεσμο")).toBeInTheDocument();
  });
});

describe("ProjectOverview facts", () => {
  it("shows the flags as Ναι/Όχι and reuses common.phase/category labels", () => {
    renderWithIntl(<ProjectOverview data={detail} state="default" noPermission={noPermission} />);
    expect(screen.getByText("Σε εξέλιξη")).toBeInTheDocument(); // phase label
    expect(screen.getByText("Ανακαίνιση")).toBeInTheDocument(); // category label
    expect(screen.getAllByText("Όχι").length).toBeGreaterThan(0); // commitmentFlag defaults false
  });
});

describe("ProjectOverview no permission", () => {
  it("renders the shell's NoPermission for the 404-as-RLS state", () => {
    renderWithIntl(<ProjectOverview data={undefined} state="noPermission" noPermission={noPermission} />);
    expect(screen.getByTestId("no-permission-stub")).toBeInTheDocument();
  });
});

describe("ProjectOverview cost", () => {
  it("passes the four ledgers straight through to CostBar", () => {
    renderWithIntl(<ProjectOverview data={detail} state="default" noPermission={noPermission} />);
    expect(screen.getByText("€ 2.000.000")).toBeInTheDocument();
  });
});

// RULE (@/auth/roles): the write controls mirror the row-policy roles.
describe("ProjectOverview write controls", () => {
  it("shows Επεξεργασία and Αλλαγή φάσης for a role that may write", () => {
    renderWithIntl(<ProjectOverview data={detail} state="default" noPermission={noPermission} roles={["estates_head"]} />);
    expect(screen.getByRole("link", { name: "Επεξεργασία" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Αλλαγή φάσης" })).toBeInTheDocument();
  });

  it("hides both for the auditor", () => {
    renderWithIntl(<ProjectOverview data={detail} state="default" noPermission={noPermission} roles={["auditor_readonly"]} />);
    expect(screen.queryByRole("link", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Αλλαγή φάσης" })).not.toBeInTheDocument();
  });

  it("hides Αλλαγή φάσης but not Επεξεργασία for finance", () => {
    renderWithIntl(<ProjectOverview data={detail} state="default" noPermission={noPermission} roles={["finance"]} />);
    expect(screen.getByRole("link", { name: "Επεξεργασία" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Αλλαγή φάσης" })).not.toBeInTheDocument();
  });
});
