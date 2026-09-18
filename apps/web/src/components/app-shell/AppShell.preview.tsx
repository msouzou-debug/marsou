import type { PreviewEntry } from "@/preview/types";
import { AppShell } from "./AppShell";
import { NoPermission } from "./NoPermission";

// "default" and "noPermission" only. Loading/empty/error belong to individual
// pages — the rail and top bar always render immediately, before any page
// data arrives (UI instructions §6); offline is the OfflineChip's own
// preview, not the shell's, once it exists.
//
// Note for reviewers: every /preview/[id] route (this one included) already
// renders inside this shell live, through src/app/layout.tsx — the states
// below are an additional, explicit illustration, not a mock environment.
const entry: PreviewEntry = {
  id: "app-shell",
  title: "App shell",
  states: {
    default: () => (
      <AppShell approvalsCount={5} userName="Μ. Ιωάννου">
        <p className="text-fs-16">Το περιεχόμενο της σελίδας εμφανίζεται εδώ.</p>
      </AppShell>
    ),
    noPermission: () => (
      <AppShell approvalsCount={5} userName="Μ. Ιωάννου">
        <NoPermission />
      </AppShell>
    ),
  },
  notes:
    "Loading, empty, error and offline are page- or component-level states, not the shell's — " +
    "the rail and top bar render immediately regardless (UI instructions §6). Every /preview/[id] " +
    "route, including this one, already renders inside AppShell via layout.tsx.",
};

export default entry;
