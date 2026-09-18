import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { ProjectListQuery, ProjectSummary, type OrgUnit, type ProjectList } from "@ecapital/shared";
import { z } from "zod";
import { Projects } from "./Projects";
import { parseProjectsQuery } from "./query";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));

function unit(id: string, code: string, nameEl: string): OrgUnit {
  return {
    id,
    code,
    nameEl,
    nameEn: nameEl,
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: null,
    timezone: "Europe/Nicosia",
  };
}

const orgUnits: OrgUnit[] = [unit("unit-a", "A", "Μονάδα Α"), unit("unit-b", "B", "Μονάδα Β")];

const rows: z.input<typeof ProjectSummary>[] = [
  {
    id: "PRJ-1",
    code: "A-001",
    orgUnitId: "unit-a",
    titleEl: "Ανακαίνιση χειρουργείου",
    category: "RENOVATION",
    phase: "IN_PROGRESS",
    approvedBudget: 1_000_000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2026-01-01",
    plannedFinish: "2027-01-01",
    rag: "GREEN",
    ragReason: "Εντός ορίων",
    sapWbs: null,
    tenderReference: null,
    // RULE (contract `ProjectLedgers`): null before the SAP import, never zero.
    ledgers: { approved: 1_000_000, committed: null, spent: null, forecast: null },
  },
  {
    id: "PRJ-2",
    code: "B-002",
    orgUnitId: "unit-b",
    titleEl: "Αντικατάσταση στέγης",
    category: "MAINTENANCE_CAPITAL",
    phase: "AWARDED",
    approvedBudget: 500_000,
    fundingSource: "EU",
    plannedStart: "2026-02-01",
    plannedFinish: "2026-11-01",
    rag: "AMBER",
    ragReason: "Σε κίνδυνο",
    sapWbs: "WBS-1",
    tenderReference: "TND-1",
    ledgers: { approved: 500_000, committed: 420_000, spent: 300_000, forecast: 480_000 },
  },
];

function list(items: z.input<typeof ProjectSummary>[] = rows): ProjectList {
  return {
    items: z.array(ProjectSummary).parse(items),
    total: items.length,
    page: 1,
    pageSize: 50,
  };
}

const query = ProjectListQuery.parse({});
const noPermission = <div data-testid="no-permission-stub" />;

describe("Projects ledgers", () => {
  it("renders «—» for null committed and spent, never «€ 0»", () => {
    renderWithIntl(
      <Projects data={list()} state="default" query={query} orgUnits={orgUnits} eyebrow="Όλες οι μονάδες" noPermission={noPermission} />,
    );
    // PRJ-1 has both ledgers null.
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("€ 0")).not.toBeInTheDocument();
  });
});

describe("Projects column order", () => {
  it("puts RAG right after Κωδικός so it is visible at 1440 without horizontal scroll", () => {
    renderWithIntl(
      <Projects data={list()} state="default" query={query} orgUnits={orgUnits} eyebrow="Όλες οι μονάδες" noPermission={noPermission} />,
    );
    const headers = Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers[0]).toBe("Κωδικός");
    expect(headers[1]).toBe("RAG");
  });
});

describe("Projects empty state", () => {
  it("shows the no-results-for-these-filters sentence and the clear-filters action", () => {
    renderWithIntl(
      <Projects
        data={list([])}
        state="empty"
        query={ProjectListQuery.parse({ q: "ανύπαρκτο" })}
        orgUnits={orgUnits}
        eyebrow="Όλες οι μονάδες"
        noPermission={noPermission}
      />,
    );
    expect(screen.getByText("Δεν βρέθηκαν έργα με αυτά τα φίλτρα.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Καθαρισμός φίλτρων" })).toBeInTheDocument();
  });
});

describe("Projects sorting", () => {
  it("pushes the sort field and direction into the URL when a sortable header is clicked", () => {
    renderWithIntl(
      <Projects data={list()} state="default" query={query} orgUnits={orgUnits} eyebrow="Όλες οι μονάδες" noPermission={noPermission} />,
    );
    replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Κωδικός/ }));
    expect(replace).toHaveBeenCalledTimes(1);
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain("sort=code");
    expect(url).toContain("dir=asc");
  });

  it("toggles direction on a second click of the same header", () => {
    renderWithIntl(
      <Projects
        data={list()}
        state="default"
        query={ProjectListQuery.parse({ sort: "code", dir: "asc" })}
        orgUnits={orgUnits}
        eyebrow="Όλες οι μονάδες"
        noPermission={noPermission}
      />,
    );
    replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Κωδικός/ }));
    const url = replace.mock.calls[0][0] as string;
    const next = parseProjectsQuery(new URLSearchParams(url.split("?")[1] ?? ""));
    expect(next.sort).toBe("code");
    expect(next.dir).toBe("desc");
  });
});

describe("Projects filters", () => {
  it("adds a unit to the URL query when checked in the Μονάδα filter", () => {
    renderWithIntl(
      <Projects data={list()} state="default" query={query} orgUnits={orgUnits} eyebrow="Όλες οι μονάδες" noPermission={noPermission} />,
    );
    replace.mockClear();
    fireEvent.click(screen.getByRole("checkbox", { name: "Μονάδα Α" }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0] as string).toContain("unit=unit-a");
  });

  it("shows the export button top right regardless of state", () => {
    renderWithIntl(
      <Projects data={list()} state="default" query={query} orgUnits={orgUnits} eyebrow="Όλες οι μονάδες" noPermission={noPermission} />,
    );
    expect(screen.getByRole("button", { name: "Εξαγωγή σε Excel" })).toBeInTheDocument();
  });
});

describe("Projects no permission", () => {
  it("renders the shell's NoPermission instead of the table", () => {
    renderWithIntl(
      <Projects data={undefined} state="noPermission" query={query} orgUnits={orgUnits} eyebrow="Όλες οι μονάδες" noPermission={noPermission} />,
    );
    expect(screen.getByTestId("no-permission-stub")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
