"use client";

// S08 — R10 (ADR-0015)
//
/**
 * Variations — the pure S08 screen body: PageTitle, the `Table` of
 * variations and (when one is open) the `VariationSheet`.
 *
 * | Prop         | Type                       | Notes                                                     |
 * |--------------|----------------------------|----------------------------------------------------------------|
 * | data         | ContractDetail?            | Ignored in `noPermission` \| `loading` \| `error`.               |
 * | state        | VariationsScreenState      | The five states (build brief §6) — this screen does have an `empty`. |
 * | roles        | AppRole[]                  | The caller's roles — `canRaiseVariations`/`canDecideVariations`.  |
 * | meUserId        | string                     | `me.userId` — the raiser comparisons live in `VariationSheet`.       |
 * | selectedId   | string \| "new" \| null    | Which row (or the new-variation form) has the sheet open.        |
 * | onSelect / onCloseSheet / onSave / onSubmit / onDecide / onRetry | — | Wired by `VariationsScreen`. |
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, ContractDetail, VariationDecision as VariationDecisionType } from "@ecapital/shared";
import { canDecideVariations, canRaiseVariations } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDate, formatEUR } from "@/lib/format";
import type { VariationFormValues } from "./schema";
import { VariationSheet } from "./VariationSheet";

export type VariationsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

type VariationRow = ContractDetail["variations"][number];

export interface VariationsProps {
  data?: ContractDetail;
  state: VariationsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  meUserId?: string;
  selectedId?: string | "new" | null;
  onSelect: (id: string | "new" | null) => void;
  sheetSaving?: boolean;
  sheetApiError?: string;
  onSave: (values: VariationFormValues) => void;
  onSubmit: () => void;
  onDecide: (decision: VariationDecisionType["decision"], comment: string | null) => void;
}

export function Variations({
  data,
  state,
  onRetry,
  noPermission,
  roles = [],
  meUserId = "",
  selectedId,
  onSelect,
  sheetSaving = false,
  sheetApiError,
  onSave,
  onSubmit,
  onDecide,
}: VariationsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const canRaise = canRaiseVariations(roles);
  const canDecide = canDecideVariations(roles);

  const columns: TableColumn<VariationRow>[] = [
    { id: "number", headerKey: "screens.s08.columns.number", accessor: (row) => row.number, numeric: true },
    { id: "description", headerKey: "screens.s08.columns.description", accessor: (row) => row.descriptionEl },
    {
      id: "reason",
      headerKey: "screens.s08.columns.reason",
      accessor: (row) => row.reason,
      cell: (row) => t(`variationReasons.${row.reason}`),
    },
    {
      id: "value",
      headerKey: "screens.s08.columns.value",
      accessor: (row) => row.value,
      numeric: true,
      cell: (row) => <span className={row.value < 0 ? "text-k-red" : undefined}>{formatEUR(row.value)}</span>,
    },
    {
      id: "timeImpact",
      headerKey: "screens.s08.columns.timeImpact",
      accessor: (row) => row.timeImpactDays,
      numeric: true,
    },
    {
      id: "status",
      headerKey: "screens.s08.columns.status",
      accessor: (row) => row.status,
      // RULE (build brief §5): a SUBMITTED row reads like an inbox — bold.
      cell: (row) => (
        <span className={row.status === "SUBMITTED" ? "font-bold text-k-ink" : undefined}>
          {t(`variationStatus.${row.status}`)}
        </span>
      ),
    },
    { id: "raisedBy", headerKey: "screens.s08.columns.raisedBy", accessor: (row) => row.raisedByName },
    {
      id: "decision",
      headerKey: "screens.s08.columns.decision",
      accessor: (row) => row.decidedAt ?? "",
      numeric: true,
      cell: (row) =>
        row.decidedByName ? `${row.decidedByName} · ${formatDate(row.decidedAt ?? "")}` : t("common.notAvailable"),
    },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";

  const selectedVariation =
    selectedId && selectedId !== "new" ? data?.variations.find((v) => v.id === selectedId) : undefined;
  const sheetOpen = selectedId !== undefined && selectedId !== null;

  return (
    <>
      <PageTitle
        eyebrow={data?.contractNo ?? ""}
        title={t("screens.s08.title")}
        action={
          canRaise && state !== "offline" ? (
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

      <Table<VariationRow>
        tableId="s08-variations"
        columns={columns}
        rows={data?.variations ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s08.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={(row) => onSelect(row.id)}
        onRetry={onRetry}
        emptyState={{
          messageKey: "screens.s08.empty",
          actionLabelKey: "buttons.add",
          onAction: canRaise ? () => onSelect("new") : undefined,
        }}
      />

      {sheetOpen && data && (
        <VariationSheet
          open
          variation={selectedVariation}
          contractNo={data.contractNo}
          contractCurrentValue={data.currentValue}
          meUserId={meUserId}
          canDecide={canDecide}
          canEdit={canRaise}
          saving={sheetSaving}
          apiError={sheetApiError}
          onClose={() => onSelect(null)}
          onSave={onSave}
          onSubmit={onSubmit}
          onDecide={onDecide}
        />
      )}
    </>
  );
}
