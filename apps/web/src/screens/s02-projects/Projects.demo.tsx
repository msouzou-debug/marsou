"use client";

// Fixture data for the preview gallery (ADR-0004), same split as
// `Portfolio.demo.tsx`. A real screen reads its `query` from the URL
// (`ProjectsScreen` via `useSearchParams`); the preview has no such URL to
// read, so it fixes one. `Projects` itself still calls the real
// `useRouter`/`usePathname` for its own filter/sort/pagination controls
// (same as S01's `UnitTable` and `FilterBar` do inside the S01 preview), so
// those controls navigate the preview route itself rather than visibly
// refetching this fixture — noted in `notes` below.

import { ProjectListQuery, ProjectSummary, type OrgUnit, type ProjectList } from "@ecapital/shared";
import { z } from "zod";
import type { ReactNode } from "react";
import { orgUnits as fixtureUnits } from "@/mocks/org-units";
import { projects } from "@/mocks/projects";
import { Projects, type ProjectsScreenState } from "./Projects";

const orgUnits: OrgUnit[] = fixtureUnits.map(({ aliases, ...unit }) => {
  void aliases;
  return unit;
});

// One fixture row with every ledger null, so the default panel exercises
// the «—» rendering rule without needing a separate state.
const rawPendingSap: z.input<typeof ProjectSummary>[] = [
  {
    id: "PRJ-DEMO-1",
    code: "NGH-901",
    orgUnitId: "nicosia-general",
    titleEl: "Επέκταση τμήματος επειγόντων περιστατικών",
    category: "NEW_BUILD",
    phase: "IDEA",
    approvedBudget: 4_200_000,
    fundingSource: "STATE_BUDGET",
    plannedStart: "2027-01-01",
    plannedFinish: "2028-06-01",
    rag: "GREEN",
    ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
    sapWbs: null,
    tenderReference: null,
    ledgers: { approved: 4_200_000, committed: null, spent: null, forecast: null },
  },
];

const defaultItems = [...z.array(ProjectSummary).parse(rawPendingSap), ...projects.slice(0, 11)];

function list(items: ProjectSummary[]): ProjectList {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

const query = ProjectListQuery.parse({});
const filteredQuery = ProjectListQuery.parse({ q: "ανακαινιση" });

export interface ProjectsDemoProps {
  state: ProjectsScreenState;
  noPermission: ReactNode;
}

export function ProjectsDemo({ state, noPermission }: ProjectsDemoProps) {
  const data = state === "empty" ? list([]) : state === "loading" ? undefined : list(state === "default" ? defaultItems : projects.slice(0, 12));

  return (
    <Projects
      data={data}
      state={state}
      query={state === "empty" ? filteredQuery : query}
      orgUnits={orgUnits}
      eyebrow="Όλες οι μονάδες"
      onRetry={() => undefined}
      noPermission={noPermission}
    />
  );
}
