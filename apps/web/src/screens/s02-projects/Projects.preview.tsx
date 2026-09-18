// S02 — R03, R06, R07

// Server Component glue (ADR-0004, same pattern as `Portfolio.preview.tsx`):
// resolves the shell's `NoPermission` (an async Server Component) once and
// hands the element down to `ProjectsDemo`, a Client Component.

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { ProjectsDemo } from "./Projects.demo";

const noPermission = <NoPermission />;

const entry: PreviewEntry = {
  id: "s02-projects",
  title: "S02 Έργα",
  states: {
    default: () => <ProjectsDemo state="default" noPermission={noPermission} />,
    loading: () => <ProjectsDemo state="loading" noPermission={noPermission} />,
    empty: () => <ProjectsDemo state="empty" noPermission={noPermission} />,
    error: () => <ProjectsDemo state="error" noPermission={noPermission} />,
    noPermission: () => <ProjectsDemo state="noPermission" noPermission={noPermission} />,
    offline: () => <ProjectsDemo state="offline" noPermission={noPermission} />,
  },
  notes:
    "Fixture: 12 rows from the mocks/projects.ts fixtures, with one row's ledgers all null " +
    "(«Επέκταση τμήματος επειγόντων περιστατικών») to show the «—» rule in the Δεσμεύσεις/Δαπάνες " +
    "columns. \"empty\" simulates a search («ανακαινιση») that matches nothing. Filter dropdowns, " +
    "sort headers and pagination call the real `useRouter`/`usePathname` (same as S01's `UnitTable` " +
    "and `FilterBar` do in the S01 preview), so they navigate this /preview route itself rather than " +
    "visibly refetching the fixed fixture below — the real screen refetches because `ProjectsScreen` " +
    "reads the query back from the URL on every render. Phone width shows the card list " +
    "(code, title, unit, RAG) in place of the table.",
};

export default entry;
