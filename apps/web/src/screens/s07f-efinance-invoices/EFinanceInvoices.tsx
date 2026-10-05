"use client";

// S07f — ADR-0029
//
/**
 * EFinanceInvoices — the pure S07f screen body: the contract's tab strip and
 * the invoices eFinance has tagged with this contract, newest first, reversed
 * ones included.
 *
 * | Prop         | Type                   | Notes                                                        |
 * |--------------|------------------------|---------------------------------------------------------------|
 * | contract     | ContractDetail?        | For the eyebrow and the tab strip.                             |
 * | list         | EFinanceInvoiceList?   | Ignored in `noPermission` \| `loading` \| `error`.              |
 * | state        | EFinanceInvoicesState  | The five states (build brief §6). `empty` says why: not configured, or nothing tagged yet. |
 * | selectedId   | string \| null?        | The invoice whose lines are open.                               |
 * | onSelect     | (id \| null) => void   |                                                               |
 * | onRetry / noPermission | —            |                                                               |
 *
 * RULE (integration record §3, ADR-0029): only «Καταχωρισμένο» counts as spend.
 * Every row keeps its ledger as a chip, and a reversed row its reason, so the
 * history reads whole while the sum does not include it.
 *
 * Nothing here writes: the invoices are eFinance's, eCapital only reads them.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ContractDetail, EFinanceInvoice, EFinanceInvoiceList } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDate, formatEURorDash } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import { EFinanceLedgerChip } from "@/screens/s07-contract/EFinanceLedgerChip";
import { InvoiceCards } from "./InvoiceCards";
import { InvoiceLinesSheet } from "./InvoiceLinesSheet";

export type EFinanceInvoicesState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface EFinanceInvoicesProps {
  contract?: ContractDetail;
  list?: EFinanceInvoiceList;
  state: EFinanceInvoicesState;
  onRetry?: () => void;
  noPermission: ReactNode;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
}

export function EFinanceInvoices({ contract, list, state, onRetry, noPermission, selectedId, onSelect }: EFinanceInvoicesProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const rows = list?.items ?? [];
  const showRows = (state === "default" || state === "offline") && rows.length > 0;

  const columns: TableColumn<EFinanceInvoice>[] = [
    { id: "invoiceNo", headerKey: "screens.s07f.columns.invoiceNo", accessor: (row) => row.invoiceNo, numeric: true, cell: (row) => row.invoiceNo ?? t("common.notAvailable") },
    {
      id: "invoiceDate",
      headerKey: "screens.s07f.columns.invoiceDate",
      accessor: (row) => row.invoiceDate,
      numeric: true,
      cell: (row) => (row.invoiceDate ? formatDate(row.invoiceDate) : t("common.notAvailable")),
    },
    {
      id: "vendor",
      headerKey: "screens.s07f.columns.vendor",
      accessor: (row) => row.vendorName,
      cell: (row) => row.vendorName ?? t("common.notAvailable"),
    },
    { id: "net", headerKey: "screens.s07f.columns.net", accessor: (row) => row.net, numeric: true, cell: (row) => formatEURorDash(row.net) },
    { id: "vat", headerKey: "screens.s07f.columns.vat", accessor: (row) => row.vat, numeric: true, cell: (row) => formatEURorDash(row.vat) },
    { id: "gross", headerKey: "screens.s07f.columns.gross", accessor: (row) => row.gross, numeric: true, cell: (row) => formatEURorDash(row.gross) },
    {
      id: "ledger",
      headerKey: "screens.s07f.columns.ledger",
      accessor: (row) => row.ledger,
      cell: (row) => (
        <span className="grid justify-items-start gap-s-1">
          <EFinanceLedgerChip ledger={row.ledger} />
          {/* RULE: a reversed invoice carries its reason in the row itself. */}
          {row.ledger === "reversed" && (
            <span className="max-w-[240px] text-fs-12 text-k-text">{row.reversalReason ?? t("screens.s07f.reversalNoReason")}</span>
          )}
        </span>
      ),
    },
    {
      id: "sapBatch",
      headerKey: "screens.s07f.columns.sapBatch",
      accessor: (row) => row.sapBatchDate,
      numeric: true,
      cell: (row) => (row.sapBatchDate ? formatDate(row.sapBatchDate) : t("common.notAvailable")),
    },
    {
      id: "lines",
      headerKey: "screens.s07f.columns.lines",
      accessor: (row) => row.lines.length,
      cell: (row) => (
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          className="min-h-[32px] rounded-k px-s-2 text-fs-14 text-k-blue-deep underline"
        >
          {t("screens.s07f.viewLines", { count: row.lines.length })}
        </button>
      ),
    },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";
  const selected = selectedId ? rows.find((row) => row.id === selectedId) : undefined;
  const emptyKey = list && !list.configured ? "screens.s07f.notConfigured" : "screens.s07f.empty";

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
        title={t("screens.s07f.title")}
        tabs={
          contract ? (
            <ContractTabs
              contractId={contract.id}
              active="efinanceInvoices"
              rfisOpenCount={contract.rfisOpen}
              defectsOpenCount={contract.defects?.filter((d) => d.status !== "CLOSED").length}
            />
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {(state === "default" || state === "offline") && <p className="mb-s-3 text-fs-14 text-k-text">{t("screens.s07f.countingRule")}</p>}

      {/* Phone (< 1024px): cards, as S08 does. Both are in the DOM at once. */}
      {showRows && (
        <div className="tablet:hidden">
          <InvoiceCards invoices={rows} onOpen={(invoice) => onSelect(invoice.id)} />
        </div>
      )}
      <div className={showRows ? "hidden tablet:block" : undefined}>
        <Table<EFinanceInvoice>
          tableId="s07f-efinance-invoices"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          captionKey="screens.s07f.caption"
          state={tableState}
          onExport={() => undefined}
          onRetry={onRetry}
          emptyState={{ messageKey: emptyKey, actionLabelKey: "buttons.add" }}
        />
      </div>

      {selected && <InvoiceLinesSheet invoice={selected} onClose={() => onSelect(null)} />}
    </>
  );
}
