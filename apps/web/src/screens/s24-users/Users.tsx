"use client";

// S24 «Χρήστες» — R01, R02, R42 (ADR-0020)
//
/**
 * Users — the pure Χρήστες screen body: the four filters, a dense `Table` of
 * the accounts, and the `UserSheet` when a row is open.
 *
 * | Prop        | Type                  | Notes                                                        |
 * |-------------|-----------------------|--------------------------------------------------------------|
 * | data        | AdminUser[]?          | Ignored in `noPermission`, `loading` and `error`.             |
 * | state       | UsersScreenState      | Which of the five states to draw (plus `offline`).            |
 * | catalogue   | RoleCatalogueEntry[]  | From `GET /admin/roles`; the screen hardcodes neither the eight roles nor which of them carry units. |
 * | orgUnits    | OrgUnit[]             | For the unit filter and the sheet's multi-select.             |
 * | filters     | UsersFilters          | Search term, role, unit, active.                              |
 *
 * RULE (ADR-0020): «Μονάδες» reads «Όλες» for an account whose roles reach
 * every unit. The list behind it really does hold all twelve ids — that is
 * what makes `finance` work — but twelve codes in a cell say nothing a reader
 * can use.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, CircleSlash } from "lucide-react";
import type { AdminUser, AppRole, OrgUnit, RoleCatalogueEntry } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDateTime } from "@/lib/format";
import { coversAllUnits, type UserFormValues } from "./schema";
import { UserSheet } from "./UserSheet";

export type UsersScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface UsersFilters {
  q: string;
  role: AppRole | "";
  unit: string;
  active: "" | "true" | "false";
}

export interface UsersProps {
  data?: AdminUser[];
  state: UsersScreenState;
  catalogue: RoleCatalogueEntry[];
  orgUnits: OrgUnit[];
  filters: UsersFilters;
  onFilters: (filters: UsersFilters) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
  selectedId?: string | "new" | null;
  onSelect: (id: string | "new" | null) => void;
  sheetSaving?: boolean;
  sheetApiError?: string;
  onSave: (values: UserFormValues) => void;
}

export function Users({
  data,
  state,
  catalogue,
  orgUnits,
  filters,
  onFilters,
  onRetry,
  noPermission,
  selectedId,
  onSelect,
  sheetSaving = false,
  sheetApiError,
  onSave,
}: UsersProps) {
  const t = useTranslations();
  const ts = useTranslations("screens.s24users");

  if (state === "noPermission") return <>{noPermission}</>;

  const unitCode = (id: string) => orgUnits.find((unit) => unit.id === id)?.code ?? id;

  const columns: TableColumn<AdminUser>[] = [
    { id: "name", headerKey: "screens.s24users.columns.name", accessor: (row) => row.name },
    {
      id: "username",
      headerKey: "screens.s24users.columns.username",
      accessor: (row) => row.username,
      cell: (row) => <span className="font-k-mono">{row.username}</span>,
    },
    {
      id: "roles",
      headerKey: "screens.s24users.columns.roles",
      accessor: (row) => row.roles.join(", "),
      cell: (row) =>
        row.roles.length ? (
          <span className="flex flex-wrap gap-s-1">
            {row.roles.map((role) => (
              <span
                key={role}
                className="rounded-k-chip bg-k-blue-bg px-s-2 py-s-1 text-fs-14 text-k-blue-deep"
              >
                {t(`roles.${role}`)}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-fs-14 text-k-text">{ts("noRole")}</span>
        ),
    },
    {
      id: "units",
      headerKey: "screens.s24users.columns.units",
      accessor: (row) => row.orgUnitIds.join(", "),
      cell: (row) =>
        coversAllUnits(catalogue, row.roles) ? (
          <span>{ts("allUnits")}</span>
        ) : (
          <span className="font-k-mono">{row.orgUnitIds.map(unitCode).join(", ")}</span>
        ),
    },
    {
      id: "lastSignInAt",
      headerKey: "screens.s24users.columns.lastSignIn",
      accessor: (row) => row.lastSignInAt ?? "",
      numeric: true,
      cell: (row) => (row.lastSignInAt ? formatDateTime(row.lastSignInAt) : t("common.notAvailable")),
    },
    {
      id: "status",
      headerKey: "screens.s24users.columns.status",
      accessor: (row) => row.active,
      cell: (row) =>
        row.active ? (
          <span className="inline-flex items-center gap-s-1 text-fs-14 text-k-ink">
            <CircleCheck size={16} strokeWidth={1.5} aria-hidden="true" className="text-k-green" />
            {ts("active")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-s-1 text-fs-14 text-k-ink">
            <CircleSlash size={16} strokeWidth={1.5} aria-hidden="true" className="text-k-red" />
            {ts("inactive")}
          </span>
        ),
    },
  ];

  const tableState =
    state === "loading"
      ? "loading"
      : state === "error"
        ? "error"
        : state === "empty"
          ? "empty"
          : state === "offline"
            ? "offline"
            : "default";
  const selectedUser = selectedId && selectedId !== "new" ? data?.find((u) => u.id === selectedId) : undefined;

  return (
    <>
      <PageTitle
        eyebrow={t("nav.admin")}
        title={ts("title")}
        action={
          state !== "offline" ? (
            <button
              type="button"
              onClick={() => onSelect("new")}
              className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k"
            >
              {t("buttons.add")}
            </button>
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="mb-s-5 flex flex-wrap items-end gap-s-3">
        <div className="flex min-w-[220px] flex-1 flex-col gap-s-1">
          <label htmlFor="users-q" className="text-fs-14 text-k-text">
            {ts("filters.search")}
          </label>
          <input
            id="users-q"
            type="search"
            value={filters.q}
            placeholder={ts("filters.searchPlaceholder")}
            onChange={(event) => onFilters({ ...filters, q: event.target.value })}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="users-role" className="text-fs-14 text-k-text">
            {ts("filters.role")}
          </label>
          <select
            id="users-role"
            value={filters.role}
            onChange={(event) => onFilters({ ...filters, role: event.target.value as AppRole | "" })}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            <option value="">{ts("filters.all")}</option>
            {catalogue.map((entry) => (
              <option key={entry.role} value={entry.role}>
                {t(`roles.${entry.role}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="users-unit" className="text-fs-14 text-k-text">
            {ts("filters.unit")}
          </label>
          <select
            id="users-unit"
            value={filters.unit}
            onChange={(event) => onFilters({ ...filters, unit: event.target.value })}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            <option value="">{ts("filters.all")}</option>
            {orgUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.nameEl}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="users-active" className="text-fs-14 text-k-text">
            {ts("filters.status")}
          </label>
          <select
            id="users-active"
            value={filters.active}
            onChange={(event) =>
              onFilters({ ...filters, active: event.target.value as UsersFilters["active"] })
            }
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            <option value="">{ts("filters.all")}</option>
            <option value="true">{ts("filters.activeOnly")}</option>
            <option value="false">{ts("filters.inactiveOnly")}</option>
          </select>
        </div>
      </div>

      <Table<AdminUser>
        tableId="s24-users"
        columns={columns}
        rows={data ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s24users.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={(row) => onSelect(row.id)}
        onRetry={onRetry}
        emptyState={{
          messageKey: "screens.s24users.empty",
          actionLabelKey: "buttons.add",
          onAction: () => onSelect("new"),
        }}
      />

      {selectedId && (
        <UserSheet
          key={selectedId}
          open
          user={selectedUser}
          catalogue={catalogue}
          orgUnits={orgUnits}
          saving={sheetSaving}
          apiError={sheetApiError}
          onClose={() => onSelect(null)}
          onSave={onSave}
        />
      )}
    </>
  );
}
