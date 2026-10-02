"use client";

// S07f — ADR-0029
//
/**
 * InvoiceLinesSheet — the detail of one eFinance invoice: where it stands, why
 * it was reversed if it was, and its lines.
 *
 * | Prop    | Type            | Notes                                    |
 * |---------|-----------------|-------------------------------------------|
 * | invoice | EFinanceInvoice | The row that was opened.                   |
 * | onClose | () => void      |                                           |
 *
 * RULE (integration record §3): spend comes from the lines, never the header
 * — which is why the lines are the point of this sheet. Whether the invoice
 * counts at all depends on its ledger, said in one sentence under the number;
 * a reversed invoice shows its reason and when, a rejected one says it never
 * posted.
 *
 * Lines are cards, not a table: seven facts a line is too wide for a 480px
 * sheet as columns and read the same at any width as a list.
 */
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { EFinanceInvoice, EFinanceInvoiceLine } from "@ecapital/shared";
import { formatDate, formatDateTime, formatEURorDash } from "@/lib/format";
import { EFinanceLedgerChip, LEDGER_LABEL_KEY } from "@/screens/s07-contract/EFinanceLedgerChip";

export interface InvoiceLinesSheetProps {
  invoice: EFinanceInvoice;
  onClose: () => void;
}

/** A quantity eFinance may send with decimals: 4, or 2,5. */
export function formatQty(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("el-GR", { maximumFractionDigits: 3 }).format(value);
}

function Fact({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-fs-12 text-k-text">{label}</dt>
      <dd className={`text-fs-14 text-k-ink ${numeric ? "num" : ""}`}>{value}</dd>
    </div>
  );
}

function LineCard({ line }: { line: EFinanceInvoiceLine }) {
  const t = useTranslations("screens.s07f.lines");
  const dash = "—";
  return (
    <li className="rounded-k border border-k-grey bg-k-white p-s-3">
      <p className="text-fs-14 font-bold text-k-ink">{line.descr ?? dash}</p>
      <dl className="mt-s-2 grid grid-cols-2 gap-x-s-3 gap-y-s-2">
        <Fact label={t("qty")} value={formatQty(line.qty)} numeric />
        <Fact label={t("unitPrice")} value={formatEURorDash(line.unitPrice)} numeric />
        <Fact label={t("lineTotal")} value={formatEURorDash(line.lineTotal)} numeric />
        <Fact label={t("costCentre")} value={line.costCentre ?? dash} numeric />
        <Fact label={t("budgetCode")} value={line.budgetCode ?? dash} numeric />
        <Fact label={t("wbs")} value={line.wbsCode ?? dash} numeric />
      </dl>
    </li>
  );
}

export function InvoiceLinesSheet({ invoice, onClose }: InvoiceLinesSheetProps) {
  const t = useTranslations("screens.s07f");
  const tc = useTranslations("common");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const title = t("sheetTitle", { number: invoice.invoiceNo ?? invoice.id });

  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-20 flex flex-col bg-k-white shadow-k desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px]"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{title}</h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={tc("close")}
          className="rounded-k p-s-2 text-k-text hover:bg-k-surface"
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-s-5">
        <div className="grid gap-s-2">
          <div className="flex flex-wrap items-center gap-s-2">
            <EFinanceLedgerChip ledger={invoice.ledger} />
            {invoice.vendorName && <span className="text-fs-14 text-k-ink">{invoice.vendorName}</span>}
          </div>
          <p className="text-fs-14 text-k-text">{t(`ledgerNote.${LEDGER_LABEL_KEY[invoice.ledger]}`)}</p>
          {invoice.ledger === "reversed" && (
            <p className="text-fs-14 text-k-ink" data-testid="invoice-reversal">
              {t("reversal", {
                when: invoice.reversedAt ? formatDateTime(invoice.reversedAt) : "—",
                reason: invoice.reversalReason ?? t("reversalNoReason"),
              })}
            </p>
          )}
          {invoice.sapBatchDate && (
            <p className="text-fs-14 text-k-text">
              {t("columns.sapBatch")}: <span className="num text-k-ink">{formatDate(invoice.sapBatchDate)}</span>
            </p>
          )}
        </div>

        <h3 className="mb-s-3 mt-s-5 text-fs-16 font-bold text-k-ink">{t("lines.title")}</h3>
        {invoice.lines.length === 0 ? (
          <p className="text-fs-14 text-k-text">{t("lines.empty")}</p>
        ) : (
          <ul className="grid gap-s-3">
            {invoice.lines.map((line) => (
              <LineCard key={line.index} line={line} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
