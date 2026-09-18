// S01 — R03

// Server Component glue (ADR-0004, same pattern as Table.preview.tsx): the
// gallery entry itself must stay a Server Component so it can resolve the
// shell's `NoPermission` (an async Server Component — see Portfolio.tsx's
// header comment) once and hand the element down; all fixtures and event
// handlers live in `Portfolio.demo.tsx`, a Client Component, since a Server
// Component cannot pass functions like `onRetry` as props across that
// boundary itself.

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { PortfolioDemo } from "./Portfolio.demo";

const noPermission = <NoPermission />;

const entry: PreviewEntry = {
  id: "s01-portfolio",
  title: "S01 Χαρτοφυλάκιο έργων",
  states: {
    default: () => <PortfolioDemo state="default" noPermission={noPermission} />,
    loading: () => <PortfolioDemo state="loading" noPermission={noPermission} />,
    empty: () => <PortfolioDemo state="empty" noPermission={noPermission} />,
    error: () => <PortfolioDemo state="error" noPermission={noPermission} />,
    noPermission: () => <PortfolioDemo state="noPermission" noPermission={noPermission} />,
    offline: () => <PortfolioDemo state="offline" noPermission={noPermission} />,
  },
  notes:
    "Fixture data — five hospitals/services across four directorates, two exceptions. " +
    "\"empty\" zeroes every unit's project count (no projects at all) rather than emptying the units array, " +
    "so the grouping toggle still has directorates to show. \"offline\" clears the exceptions to also exercise " +
    "the never-empty sentence. Turn on «Ομαδοποίηση κατά Διεύθυνση» in the default state to see the directorate " +
    "subtotals.",
};

export default entry;
