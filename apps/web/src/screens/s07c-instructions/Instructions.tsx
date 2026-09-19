"use client";

// S07c — R09 (ADR-0017)
//
/**
 * Instructions — the pure S07c screen body: the contract tab strip, the
 * amber `instructionsWithoutVariation` strip when the contract carries that
 * warning, the `Table` of site instructions and (when one is open) the
 * `InstructionSheet`.
 *
 * | Prop         | Type                    | Notes                                                        |
 * |--------------|-------------------------|-------------------------------------------------------------------|
 * | contract     | ContractDetail?         | For the eyebrow, tab strip, its counts, the warning and the linked variation's number. |
 * | instructions | SiteInstruction[]?      | Ignored in `noPermission` \| `loading` \| `error`.                  |
 * | state        | InstructionsScreenState | The five states.                                                    |
 * | roles        | AppRole[]               | `canWriteSiteInstructions(roles)`.                                  |
 *
 * RULE (ADR-0017): only a cost-impact instruction may become a variation,
 * and only once — the API refuses `errors.noCostImpact` / `errors.alreadyLinked`
 * and this screen renders that sentence verbatim rather than a second one.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, TriangleAlert, X as XIcon } from "lucide-react";
import type { AppRole, ContractDetail, SiteInstruction } from "@ecapital/shared";
import { canWriteSiteInstructions } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDate } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import type { InstructionFormValues } from "./schema";
import { InstructionSheet } from "./InstructionSheet";

export type InstructionsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface InstructionsProps {
  contract?: ContractDetail;
  instructions?: SiteInstruction[];
  state: InstructionsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  selectedId?: string | "new" | null;
  onSelect: (id: string | "new" | null) => void;
  sheetSaving?: boolean;
  sheetApiError?: string;
  creatingVariationId?: string | null;
  onCreate: (values: InstructionFormValues) => void;
  onCreateVariation: (instruction: SiteInstruction) => void;
}

export function Instructions({
  contract,
  instructions,
  state,
  onRetry,
  noPermission,
  roles = [],
  selectedId,
  onSelect,
  sheetSaving = false,
  sheetApiError,
  creatingVariationId,
  onCreate,
  onCreateVariation,
}: InstructionsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const canWrite = canWriteSiteInstructions(roles);
  const rows = instructions ?? [];
  const variationNumberOf = (variationId: string | null) => contract?.variations.find((v) => v.id === variationId)?.number;
  const hasWithoutVariationWarning = contract?.warnings.some((w) => w.key === "instructionsWithoutVariation") ?? false;

  const columns: TableColumn<SiteInstruction>[] = [
    { id: "number", headerKey: "screens.s07c.columns.number", accessor: (row) => row.number, numeric: true },
    {
      id: "instruction",
      headerKey: "screens.s07c.columns.instruction",
      accessor: (row) => row.textEl,
      cell: (row) => (
        <span className="block max-w-[280px] truncate" title={row.textEl}>
          {row.textEl}
        </span>
      ),
    },
    { id: "issuedBy", headerKey: "screens.s07c.columns.issuedBy", accessor: (row) => row.issuedByName },
    { id: "issuedAt", headerKey: "screens.s07c.columns.issuedAt", accessor: (row) => row.issuedAt, numeric: true, cell: (row) => formatDate(row.issuedAt) },
    {
      id: "costImpact",
      headerKey: "screens.s07c.columns.costImpact",
      accessor: (row) => (row.costImpactFlag ? 1 : 0),
      cell: (row) => (
        <span className="inline-flex items-center gap-s-1">
          {row.costImpactFlag ? (
            <Check size={20} strokeWidth={1.5} aria-hidden="true" className="text-k-ink" />
          ) : (
            <XIcon size={20} strokeWidth={1.5} aria-hidden="true" className="text-k-text-muted" />
          )}
          {row.costImpactFlag ? t("common.yes") : t("common.no")}
        </span>
      ),
    },
    {
      id: "variation",
      headerKey: "screens.s07c.columns.variation",
      accessor: (row) => row.variationId ?? "",
      sortable: false,
      cell: (row) => {
        if (row.variationId) {
          const number = variationNumberOf(row.variationId);
          return (
            <a
              href={`/contracts/${encodeURIComponent(row.contractId)}/variations`}
              className="text-k-blue underline-offset-2 hover:underline"
            >
              {number !== undefined ? t("screens.s07c.variationLink", { number }) : t("common.notAvailable")}
            </a>
          );
        }
        if (row.costImpactFlag && canWrite) {
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateVariation(row);
              }}
              disabled={creatingVariationId === row.id}
              className="rounded-k border border-k-grey px-s-2 py-s-1 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
            >
              {t("screens.s07c.createVariation")}
            </button>
          );
        }
        return <span className="text-k-text-muted">{t("common.notAvailable")}</span>;
      },
    },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";
  const selectedInstruction = selectedId && selectedId !== "new" ? rows.find((r) => r.id === selectedId) : undefined;
  const sheetOpen = selectedId !== undefined && selectedId !== null;

  return (
    <>
      <PageTitle
        eyebrow={contract?.contractNo ?? ""}
        title={t("screens.s07c.title")}
        tabs={
          contract ? (
            <ContractTabs
              contractId={contract.id}
              active="instructions"
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

      {hasWithoutVariationWarning &&
        contract!.warnings
          .filter((w) => w.key === "instructionsWithoutVariation")
          .map((warning) => (
            <p key={warning.key} role="status" className="mb-s-4 flex items-start gap-s-2 rounded-k border border-k-amber bg-k-amber-bg px-s-3 py-s-2 text-fs-14 text-k-ink">
              <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" className="mt-[2px] shrink-0 text-k-amber" />
              <span>{warning.sentenceEl}</span>
            </p>
          ))}

      {sheetApiError && !sheetOpen && (
        <p role="alert" className="mb-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {sheetApiError}
        </p>
      )}

      <Table<SiteInstruction>
        tableId="s07c-instructions"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        captionKey="screens.s07c.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={(row) => onSelect(row.id)}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s07c.empty", actionLabelKey: "buttons.add", onAction: canWrite ? () => onSelect("new") : undefined }}
      />

      {sheetOpen && (
        <InstructionSheet
          open
          instruction={selectedInstruction}
          variationNumber={selectedInstruction?.variationId ? variationNumberOf(selectedInstruction.variationId) : undefined}
          canWrite={canWrite}
          creatingVariation={!!selectedInstruction && creatingVariationId === selectedInstruction.id}
          saving={sheetSaving}
          apiError={sheetOpen ? sheetApiError : undefined}
          onClose={() => onSelect(null)}
          onCreate={onCreate}
          onCreateVariation={() => selectedInstruction && onCreateVariation(selectedInstruction)}
        />
      )}
    </>
  );
}
