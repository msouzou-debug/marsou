// S03 — R04

import type { PreviewEntry } from "@/preview/types";
import { PhaseDialog } from "./PhaseDialog";

const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s03-phase-dialog",
  title: "S03 Αλλαγή φάσης",
  states: {
    default: () => (
      <PhaseDialog open currentPhase="PREPARATION" isAdmin={false} submitting={false} onCancel={noop} onSubmit={noop} />
    ),
    submitting: () => (
      <PhaseDialog open currentPhase="PREPARATION" isAdmin={false} submitting onCancel={noop} onSubmit={noop} />
    ),
    error: () => (
      <PhaseDialog
        open
        currentPhase="PREPARATION"
        isAdmin={false}
        submitting={false}
        apiError={{
          message:
            "Το ορόσημο «Έγκριση μελέτης» κλείνει το τρέχον στάδιο και δεν έχει ολοκληρωθεί. Καταχωρίστε την πραγματική του ημερομηνία και μετά προχωρήστε το έργο.",
          gateMilestoneId: "milestone-demo",
        }}
        onCancel={noop}
        onSubmit={noop}
      />
    ),
  },
  notes:
    "PREPARATION → APPROVED for an estates_head (only the next phase, R04). The admin " +
    "variant — the extra «Προηγούμενη φάση» radio option — is exercised by " +
    "`PhaseDialog.test.tsx` (`isAdmin` true) rather than a fourth static state here, since " +
    "`<dialog>` doesn't render outside a real browser in `next dev`'s SSR-only preview " +
    "capture the way jsdom's fallback does in tests. \"error\" is `errors.gateOpen`, with the " +
    "link to the milestone card the screen resolves when it can (the current phase's own " +
    "open gate). No empty/noPermission/offline — same reasoning as `ConfirmDialog`: this " +
    "dialog holds no data of its own to load, and the caller hides the «Αλλαγή φάσης» " +
    "button entirely for a role that cannot write (see `ProjectOverview`'s header comment).",
};

export default entry;
