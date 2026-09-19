"use client";

// S24 — R08
//
/**
 * Contractors — the pure S24 screen body: `Table` of the register plus,
 * when open, the `ContractorSheet` for «Προσθήκη» or an edit.
 *
 * | Prop     | Type                    | Notes                                                    |
 * |----------|-------------------------|---------------------------------------------------------------|
 * | data     | Contractor[]?           |                                                                   |
 * | state    | ContractorsScreenState  |                                                                   |
 * | isAdmin  | boolean                 | The blacklist toggle's own gate, passed through to `ContractorSheet`. |
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { Contractor } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import type { ContractorFormValues } from "./schema";
import { ContractorSheet } from "./ContractorSheet";

export type ContractorsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface ContractorsProps {
  data?: Contractor[];
  state: ContractorsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  isAdmin?: boolean;
  selectedId?: string | "new" | null;
  onSelect: (id: string | "new" | null) => void;
  sheetSaving?: boolean;
  sheetApiError?: string;
  onSave: (values: ContractorFormValues, blacklisted?: boolean) => void;
}

export function Contractors({
  data,
  state,
  onRetry,
  noPermission,
  isAdmin = false,
  selectedId,
  onSelect,
  sheetSaving = false,
  sheetApiError,
  onSave,
}: ContractorsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const columns: TableColumn<Contractor>[] = [
    { id: "name", headerKey: "screens.s24.columns.name", accessor: (row) => row.name },
    { id: "vatNumber", headerKey: "screens.s24.columns.vatNumber", accessor: (row) => row.vatNumber ?? "" },
    {
      id: "registrationNo",
      headerKey: "screens.s24.columns.registrationNo",
      accessor: (row) => row.registrationNo ?? "",
    },
    {
      id: "category",
      headerKey: "screens.s24.columns.category",
      accessor: (row) => row.category,
      cell: (row) => t(`contractorCategories.${row.category}`),
    },
    { id: "sapVendorId", headerKey: "screens.s24.columns.sapVendorId", accessor: (row) => row.sapVendorId ?? "" },
    {
      id: "status",
      headerKey: "screens.s24.columns.status",
      accessor: (row) => row.blacklisted,
      cell: (row) =>
        row.blacklisted ? (
          <span className="inline-flex items-center gap-s-1 rounded-k-chip bg-k-red-bg px-s-2 py-s-1 text-fs-14 text-k-ink">
            <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" className="text-k-red" />
            {t("screens.s24.blacklistedChip")}
          </span>
        ) : null,
    },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";
  const selectedContractor = selectedId && selectedId !== "new" ? data?.find((c) => c.id === selectedId) : undefined;

  return (
    <>
      <PageTitle
        eyebrow={t("nav.admin")}
        title={t("screens.s24.title")}
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

      <Table<Contractor>
        tableId="s24-contractors"
        columns={columns}
        rows={data ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s24.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={(row) => onSelect(row.id)}
        onRetry={onRetry}
        emptyState={{
          messageKey: "screens.s24.empty",
          actionLabelKey: "buttons.add",
          onAction: () => onSelect("new"),
        }}
      />

      {selectedId && (
        <ContractorSheet
          open
          contractor={selectedContractor}
          isAdmin={isAdmin}
          saving={sheetSaving}
          apiError={sheetApiError}
          onClose={() => onSelect(null)}
          onSave={onSave}
        />
      )}
    </>
  );
}
