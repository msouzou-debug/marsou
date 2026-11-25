// S18b — the agreements dashboard (owner UAT)

import { MaintenanceAgreementQuery } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import { buildMaintenanceAgreementList } from "@/mocks/maintenance";
import { orgUnits } from "@/mocks/org-units";
import type { PreviewEntry } from "@/preview/types";
import { AgreementsDashboard, type AgreementsDashboardProps } from "./AgreementsDashboard";
import { PlanTabs } from "./PlanTabs";

const base: AgreementsDashboardProps = {
  data: buildMaintenanceAgreementList(),
  state: "default",
  query: MaintenanceAgreementQuery.parse({}),
  orgUnits,
  onQueryChange: () => undefined,
  onOpen: () => undefined,
  onRetry: () => undefined,
  noPermission: <NoPermission />,
  tabs: <PlanTabs active="dashboard" />,
};

const entry: PreviewEntry = {
  id: "s18b-agreements",
  title: "S18b Συμβάσεις συντήρησης",
  states: {
    default: () => <AgreementsDashboard {...base} />,
    loading: () => <AgreementsDashboard {...base} data={undefined} state="loading" />,
    empty: () => <AgreementsDashboard {...base} data={buildMaintenanceAgreementList({ items: [] })} state="empty" query={MaintenanceAgreementQuery.parse({ assetClass: ["LIFT"] })} />,
    error: () => <AgreementsDashboard {...base} data={undefined} state="error" />,
    noPermission: () => <AgreementsDashboard {...base} state="noPermission" />,
    offline: () => <AgreementsDashboard {...base} state="offline" />,
  },
  notes: "One agreement in each band: Nicosia in force, Larnaca 40 days from its end, Paphos ended with no value recorded. Filters live in the URL; «Ανά μονάδα» is the per-unit view.",
};

export default entry;
