// S02a — R04, R05

import type { OrgUnit } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { orgUnits as fixtureUnits } from "@/mocks/org-units";
import { ProjectForm } from "./ProjectForm";

const orgUnits: OrgUnit[] = fixtureUnits.map(({ aliases, ...unit }) => {
  void aliases;
  return unit;
});

const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s02a-project-form",
  title: "S02a Νέο έργο",
  states: {
    default: () => (
      <ProjectForm
        mode="create"
        orgUnits={orgUnits}
        defaultOrgUnitId={orgUnits[0]?.id}
        submitting={false}
        onSubmit={noop}
        onCancel={noop}
      />
    ),
    submitting: () => (
      <ProjectForm
        mode="create"
        orgUnits={orgUnits}
        defaultOrgUnitId={orgUnits[0]?.id}
        submitting
        onSubmit={noop}
        onCancel={noop}
      />
    ),
    error: () => (
      <ProjectForm
        mode="create"
        orgUnits={orgUnits}
        defaultOrgUnitId={orgUnits[0]?.id}
        submitting={false}
        apiError="Δεν έχετε δικαίωμα δημιουργίας νέου έργου."
        budgetFieldError="Μόνο η Οικονομική Διεύθυνση μπορεί να αλλάξει τον προϋπολογισμό μετά την έγκριση."
        onSubmit={noop}
        onCancel={noop}
      />
    ),
  },
  notes:
    "The create form, at the S02a route's own Μονάδα field (hidden here it would be if there " +
    "were only one visible unit — the eleven-unit fixture keeps it visible). The edit form " +
    "(`/projects/[id]/edit`) is the same component with `mode=\"edit\"` and `initialValues` set, " +
    "which drops the Μονάδα field — not previewed separately since nothing else about it " +
    "differs. \"error\" shows both failure paths at once for space: the general strip (any " +
    "non-budget 403, a network failure) and the budget-field message (ADR-0014's " +
    "`errors.budgetFinanceOnly`, decided 19/09/2026) would not actually appear together from " +
    "one real submission. No empty/noPermission/offline — see the component's own header " +
    "comment for why.",
};

export default entry;
