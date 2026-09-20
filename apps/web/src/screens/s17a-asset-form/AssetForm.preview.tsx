import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrgUnit } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { AssetForm } from "./AssetForm";

const ORG_UNITS: OrgUnit[] = [
  {
    id: "nicosia-general",
    code: "NGH",
    nameEl: "Νοσοκομείο Λευκωσίας",
    nameEn: "Nicosia General Hospital",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: null,
    entityCode: "NGH",
    efinanceCode: "NGH",
    timezone: "Europe/Nicosia",
  },
];

// A fresh, isolated QueryClient per render — the gallery is dev-only and has
// no shell-level provider (see `PreviewLayout`'s own comment), and this
// form's own `useAreaTree`/`useProjectsForUnit`/`useContractsForUnit`/parent
// search all need one. Every query fails in the gallery (no signed-in
// session to proxy through) and settles into each hook's own harmless
// "nothing yet" rendering — the AreaPicker's loading line, empty selects —
// rather than throwing.
function withQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const entry: PreviewEntry = {
  id: "s17a-asset-form",
  title: "AssetForm (S17a)",
  states: {
    default: () =>
      withQuery(<AssetForm mode="create" orgUnits={ORG_UNITS} readOnly={false} submitting={false} onSubmit={() => undefined} onCancel={() => undefined} />),
    submitting: () =>
      withQuery(<AssetForm mode="create" orgUnits={ORG_UNITS} readOnly={false} submitting={true} onSubmit={() => undefined} onCancel={() => undefined} />),
    error: () =>
      withQuery(
        <AssetForm
          mode="create"
          orgUnits={ORG_UNITS}
          readOnly={false}
          submitting={false}
          apiError="Ο κωδικός SAP παγίου χρησιμοποιείται ήδη."
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />,
      ),
  },
  notes:
    "No empty/noPermission/offline: a write form has no list to be empty, " +
    "no-permission keeps the page from rendering it at all, and there is " +
    "nothing useful to show read-only while offline beyond the read-only " +
    "mode already covers for a technician (UI instructions §6). The gallery " +
    "has no signed-in session, so every per-unit query here fails quietly — " +
    "the area picker shows its loading line and the project/contract selects " +
    "stay empty, same as a real session mid-fetch.",
};

export default entry;
