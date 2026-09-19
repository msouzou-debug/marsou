// S24 «Χρήστες» — R01, R02 (ADR-0020)

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { Users, type UsersFilters } from "./Users";
import { orgUnits, roleCatalogue, users } from "./fixture";

const noPermission = <NoPermission />;
const noop = () => undefined;
const filters: UsersFilters = { q: "", role: "", unit: "", active: "" };

const shared = {
  catalogue: roleCatalogue,
  orgUnits,
  filters,
  onFilters: noop,
  noPermission,
  onSelect: noop,
  onSave: noop,
};

const entry: PreviewEntry = {
  id: "s24-users",
  title: "S24 Χρήστες",
  states: {
    default: () => <Users {...shared} data={users} state="default" />,
    loading: () => <Users {...shared} state="loading" />,
    empty: () => <Users {...shared} data={[]} state="empty" />,
    error: () => <Users {...shared} state="error" onRetry={noop} />,
    noPermission: () => <Users {...shared} state="noPermission" />,
  },
  notes:
    "«Μονάδες» reads «Όλες» for a role that reaches every unit (ADR-0020) — the row really does " +
    "carry all twelve ids, which is what makes `finance` work, but twelve codes in a cell say " +
    "nothing useful. The auditor's checkbox in the sheet is disabled with a title pointing at the " +
    "server's grant-role command (CAPEX-01 §10), and the unit multi-select is disabled while every " +
    "ticked role covers all units. The page itself (`/admin/users`) is gated to `admin` before this " +
    "component renders. Offline is the sixth state, drawn by `Table`.",
};

export default entry;
