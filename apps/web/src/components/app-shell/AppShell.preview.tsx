import type { Me } from "@ecapital/shared";
import { orgUnits } from "@/mocks/org-units";
import type { PreviewEntry } from "@/preview/types";
import { AppShell } from "./AppShell";
import { NoPermission } from "./NoPermission";

// "default" and "noPermission" only. Loading/empty/error belong to individual
// pages — the rail and top bar always render immediately, before any page
// data arrives (UI instructions §6); offline is the OfflineChip's own
// preview, not the shell's.
//
// The gallery is outside the gate (ADR-0004, src/proxy.ts), so there is no
// session here and no `GET /org-units` to call: these props are fixtures, the
// same twelve units the mock portfolio uses. In the product the shell gets
// both from `src/app/(app)/layout.tsx`.
const me: Me = {
  sub: "preview",
  userId: "preview-user",
  name: "Μ. Ιωάννου",
  email: "preview@ecapital.test",
  roles: ["estates_head"],
  orgUnitIds: orgUnits.map((u) => u.id),
};

const entry: PreviewEntry = {
  id: "app-shell",
  title: "App shell",
  states: {
    default: () => (
      <AppShell approvalsCount={5} me={me} orgUnits={orgUnits}>
        <p className="text-fs-16">Το περιεχόμενο της σελίδας εμφανίζεται εδώ.</p>
      </AppShell>
    ),
    noPermission: () => (
      <AppShell approvalsCount={5} me={me} orgUnits={orgUnits}>
        <NoPermission />
      </AppShell>
    ),
  },
  notes:
    "Loading, empty, error and offline are page- or component-level states, not the shell's — " +
    "the rail and top bar render immediately regardless (UI instructions §6). The units and the " +
    "user here are fixtures: the gallery has no session, while the product's shell gets both from " +
    "the session and GET /org-units.",
};

export default entry;
