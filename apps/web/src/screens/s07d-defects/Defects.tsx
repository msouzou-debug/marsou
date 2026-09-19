"use client";

// S07d — R12, R35 (ADR-0017)
//
/**
 * Defects — the pure S07d screen body: the contract tab strip, the `Table`
 * of the contract's own handover defects, a footer line of count and cost by
 * risk band, and (when one is open) the `DefectSheet`.
 *
 * | Prop           | Type                              | Notes                                                        |
 * |----------------|-------------------------------------|-------------------------------------------------------------------|
 * | contract       | ContractDetail?                     | For the eyebrow and the tab strip's counts.                        |
 * | defects        | Defect[]?                           | Ignored in `noPermission` \| `loading` \| `error`.                  |
 * | areaNameById   | Map<string, string>?                | From the unit's area tree; a `areaId` missing from it renders as a mono id (RULE below). |
 * | projectById    | Map<string, {code, titleEl}>?       | From the unit's own projects, for the funded target link and the sheet's select. |
 * | state          | DefectsScreenState                  | The five states.                                                    |
 * | roles          | AppRole[]                           | `canWriteContracts(roles)` — this screen only ever offers HANDOVER, which a technician may not write (ADR-0017). |
 * | today          | Date?                               | Injectable "now" for the overdue rule.                              |
 *
 * RULE (ADR-0017): a handover defect still open past its `dueDate` is a red
 * exception — past the liability period the contractor is off the hook and
 * ΟΚΥπΥ pays. A `CLOSED` one is never marked overdue, whatever its due date.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import type { AppRole, ContractDetail, Defect } from "@ecapital/shared";
import { RiskBand } from "@ecapital/shared";
import { canWriteContracts } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDate, formatEURorDash } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import { DefectSheet, type DefectAreaOption, type DefectProjectOption } from "./DefectSheet";
import { RiskBandChip } from "./RiskBandChip";
import type { DefectCreateFormValues, DefectUpdateFormValues } from "./schema";

export type DefectsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface DefectsProps {
  contract?: ContractDetail;
  defects?: Defect[];
  areaNameById?: Map<string, string>;
  areaOptions?: DefectAreaOption[];
  projectById?: Map<string, DefectProjectOption>;
  projectOptions?: DefectProjectOption[];
  state: DefectsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  today?: Date;
  selectedId?: string | "new" | null;
  onSelect: (id: string | "new" | null) => void;
  sheetSaving?: boolean;
  sheetApiError?: string;
  onCreate: (values: DefectCreateFormValues) => void;
  onUpdate: (values: DefectUpdateFormValues) => void;
}

function isOverdue(defect: Defect, today: Date): boolean {
  return defect.status !== "CLOSED" && !!defect.dueDate && new Date(defect.dueDate).getTime() < today.getTime();
}

export function Defects({
  contract,
  defects,
  areaNameById = new Map(),
  areaOptions = [],
  projectById = new Map(),
  projectOptions = [],
  state,
  onRetry,
  noPermission,
  roles = [],
  today = new Date(),
  selectedId,
  onSelect,
  sheetSaving = false,
  sheetApiError,
  onCreate,
  onUpdate,
}: DefectsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const canWrite = canWriteContracts(roles);
  const rows = defects ?? [];

  const columns: TableColumn<Defect>[] = [
    {
      id: "description",
      headerKey: "screens.s07d.columns.description",
      accessor: (row) => row.descriptionEl,
      cell: (row) => (
        <span className="block max-w-[260px] truncate" title={row.descriptionEl}>
          {row.descriptionEl}
        </span>
      ),
    },
    {
      id: "area",
      headerKey: "screens.s07d.columns.area",
      accessor: (row) => row.areaId ?? "",
      cell: (row) => {
        if (!row.areaId) return <span className="text-k-text-muted">{t("common.notAvailable")}</span>;
        const name = areaNameById.get(row.areaId);
        // RULE: an areaId the caller's own area-tree fetch does not carry —
        // a different unit's area, or the tree still loading — renders as
        // the id itself, mono, with a note rather than a blank cell.
        return name ? <span>{name}</span> : (
          <span className="num text-k-text-muted" title={t("screens.s07d.areaUnknownNote")}>
            {row.areaId}
          </span>
        );
      },
    },
    {
      id: "riskBand",
      headerKey: "screens.s07d.columns.riskBand",
      accessor: (row) => RiskBand.options.indexOf(row.riskBand),
      cell: (row) => <RiskBandChip value={row.riskBand} />,
    },
    {
      id: "estimatedCost",
      headerKey: "screens.s07d.columns.estimatedCost",
      accessor: (row) => row.estimatedCost ?? -1,
      numeric: true,
      cell: (row) => formatEURorDash(row.estimatedCost),
    },
    {
      id: "funded",
      headerKey: "screens.s07d.columns.funded",
      accessor: (row) => (row.funded ? 1 : 0),
      cell: (row) => {
        if (!row.funded) return t("common.no");
        const project = row.targetProjectId ? projectById.get(row.targetProjectId) : undefined;
        return (
          <span>
            {t("common.yes")}
            {project && row.targetProjectId && (
              <>
                {" · "}
                <a href={`/projects/${encodeURIComponent(row.targetProjectId)}`} className="text-k-blue underline-offset-2 hover:underline">
                  {project.code}
                </a>
              </>
            )}
          </span>
        );
      },
    },
    {
      id: "dueDate",
      headerKey: "screens.s07d.columns.dueDate",
      accessor: (row) => row.dueDate ?? "",
      numeric: true,
      cell: (row) => {
        if (!row.dueDate) return <span className="text-k-text-muted">{t("common.notAvailable")}</span>;
        const overdue = isOverdue(row, today);
        return (
          <span className={`inline-flex items-center gap-s-1 ${overdue ? "text-k-red" : "text-k-ink"}`}>
            {overdue && <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />}
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      id: "status",
      headerKey: "screens.s07d.columns.status",
      accessor: (row) => row.status,
      cell: (row) => t(`defectStatus.${row.status}`),
    },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";
  const selectedDefect = selectedId && selectedId !== "new" ? rows.find((d) => d.id === selectedId) : undefined;
  const sheetOpen = selectedId !== undefined && selectedId !== null;

  const bandSummary = RiskBand.options
    .map((band) => {
      const bandRows = rows.filter((row) => row.riskBand === band);
      if (bandRows.length === 0) return null;
      const cost = bandRows.reduce((sum, row) => sum + (row.estimatedCost ?? 0), 0);
      return `${t(`riskBands.${band}`)} ${bandRows.length} · ${formatEURorDash(cost)}`;
    })
    .filter((line): line is string => line !== null);

  return (
    <>
      <PageTitle
        eyebrow={contract?.contractNo ?? ""}
        title={t("screens.s07d.title")}
        tabs={
          contract ? (
            <ContractTabs
              contractId={contract.id}
              active="defects"
              rfisOpenCount={contract.rfisOpen}
              defectsOpenCount={contract.defects?.filter((d) => d.status !== "CLOSED").length}
            />
          ) : undefined
        }
        action={
          canWrite && state !== "offline" ? (
            <button type="button" onClick={() => onSelect("new")} className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k">
              {t("buttons.add")}
            </button>
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <Table<Defect>
        tableId="s07d-defects"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        captionKey="screens.s07d.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={(row) => onSelect(row.id)}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s07d.empty", actionLabelKey: "buttons.add", onAction: canWrite ? () => onSelect("new") : undefined }}
      />

      {bandSummary.length > 0 && (state === "default" || state === "offline") && (
        <p className="num mt-s-3 text-fs-14 text-k-text">{bandSummary.join(" · ")}</p>
      )}

      {sheetOpen && (
        <DefectSheet
          open
          defect={selectedDefect}
          areas={areaOptions}
          projects={projectOptions}
          canWrite={canWrite}
          saving={sheetSaving}
          apiError={sheetApiError}
          onClose={() => onSelect(null)}
          onCreate={onCreate}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}
