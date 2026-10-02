"use client";

// S07g — ADR-0029
//
/**
 * EFinanceRequisitions — the pure S07g screen body: the contract's tab strip
 * and the requisitions eFinance has tagged with this contract, newest first.
 *
 * | Prop         | Type                       | Notes                                                |
 * |--------------|----------------------------|-------------------------------------------------------|
 * | contract     | ContractDetail?            | For the eyebrow and the tab strip.                     |
 * | list         | EFinanceRequisitionList?   | Ignored in `noPermission` \| `loading` \| `error`.      |
 * | state        | EFinanceRequisitionsState  | The five states (build brief §6).                      |
 * | onRetry / noPermission | —                |                                                       |
 *
 * RULE (ADR-0015, ADR-0029): a requisition is eFinance's own commitment. It
 * is shown here and in «Δεσμεύσεις eFinance» on S07, and is never added to
 * eCapital's committed ledger; the line under the title says so.
 *
 * `status` is eFinance's own word (the record does not fix a vocabulary), so
 * it is shown as eFinance sends it rather than translated by a guess.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ContractDetail, EFinanceRequisition, EFinanceRequisitionList } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDate, formatEURorDash } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import { RequisitionCards } from "./RequisitionCards";

export type EFinanceRequisitionsState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface EFinanceRequisitionsProps {
  contract?: ContractDetail;
  list?: EFinanceRequisitionList;
  state: EFinanceRequisitionsState;
  onRetry?: () => void;
  noPermission: ReactNode;
}

export function EFinanceRequisitions({ contract, list, state, onRetry, noPermission }: EFinanceRequisitionsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const rows = list?.items ?? [];
  const showRows = (state === "default" || state === "offline") && rows.length > 0;
  const dash = t("common.notAvailable");

  const columns: TableColumn<EFinanceRequisition>[] = [
    { id: "number", headerKey: "screens.s07g.columns.number", accessor: (row) => row.number, numeric: true },
    {
      id: "description",
      headerKey: "screens.s07g.columns.description",
      accessor: (row) => row.description,
      cell: (row) => (
        <span className="block max-w-[360px] truncate" title={row.description ?? undefined}>
          {row.description ?? dash}
        </span>
      ),
    },
    { id: "amount", headerKey: "screens.s07g.columns.amount", accessor: (row) => row.amount, numeric: true, cell: (row) => formatEURorDash(row.amount) },
    { id: "status", headerKey: "screens.s07g.columns.status", accessor: (row) => row.status },
    { id: "poNumber", headerKey: "screens.s07g.columns.poNumber", accessor: (row) => row.poNumber, numeric: true, cell: (row) => row.poNumber ?? dash },
    { id: "createdAt", headerKey: "screens.s07g.columns.createdAt", accessor: (row) => row.createdAt, numeric: true, cell: (row) => formatDate(row.createdAt) },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";
  const emptyKey = list && !list.configured ? "screens.s07g.notConfigured" : "screens.s07g.empty";

  return (
    <>
      <PageTitle
        eyebrow={
          contract ? (
            <>
              <span className="num">{contract.ref}</span>
              {` · ${contract.contractNo}`}
            </>
          ) : (
            ""
          )
        }
        title={t("screens.s07g.title")}
        tabs={
          contract ? (
            <ContractTabs
              contractId={contract.id}
              active="efinanceRequisitions"
              rfisOpenCount={contract.rfisOpen}
              defectsOpenCount={contract.defects?.filter((d) => d.status !== "CLOSED").length}
            />
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {(state === "default" || state === "offline") && <p className="mb-s-3 text-fs-14 text-k-text">{t("screens.s07g.commitmentRule")}</p>}

      {showRows && (
        <div className="tablet:hidden">
          <RequisitionCards requisitions={rows} />
        </div>
      )}
      <div className={showRows ? "hidden tablet:block" : undefined}>
        <Table<EFinanceRequisition>
          tableId="s07g-efinance-requisitions"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          captionKey="screens.s07g.caption"
          state={tableState}
          onExport={() => undefined}
          onRetry={onRetry}
          emptyState={{ messageKey: emptyKey, actionLabelKey: "buttons.add" }}
        />
      </div>
    </>
  );
}
