"use client";

// S07f — ADR-0029 (phone layout)
//
// The phone layout for the invoice list (< 1024px): one card per invoice —
// number, date, vendor, gross, ledger chip and, for a reversed invoice, its
// reason — instead of the ten-column table. The same `tablet:hidden` /
// `hidden tablet:block` split S08's `VariationCards` makes next to its Table.
import { useTranslations } from "next-intl";
import type { EFinanceInvoice } from "@ecapital/shared";
import { formatDate, formatEURorDash } from "@/lib/format";
import { EFinanceLedgerChip } from "@/screens/s07-contract/EFinanceLedgerChip";

export interface InvoiceCardsProps {
  invoices: EFinanceInvoice[];
  onOpen: (invoice: EFinanceInvoice) => void;
}

export function InvoiceCards({ invoices, onOpen }: InvoiceCardsProps) {
  const t = useTranslations("screens.s07f");
  return (
    <ul className="grid gap-s-3">
      {invoices.map((invoice) => (
        <li key={invoice.id}>
          <button
            type="button"
            onClick={() => onOpen(invoice)}
            className="block min-h-[44px] w-full rounded-k border border-k-grey bg-k-white p-s-4 text-left shadow-k"
          >
            <div className="flex items-start justify-between gap-s-2">
              <span className="num text-fs-14 text-k-ink">{invoice.invoiceNo ?? invoice.id}</span>
              <EFinanceLedgerChip ledger={invoice.ledger} />
            </div>
            <p className="mt-s-1 text-fs-16 text-k-ink">{invoice.vendorName ?? "—"}</p>
            <p className="num mt-s-1 text-fs-14 text-k-text">{invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "—"}</p>
            <dl className="mt-s-2 grid grid-cols-3 gap-s-2 text-fs-14">
              <div>
                <dt className="text-fs-12 text-k-text">{t("columns.net")}</dt>
                <dd className="num text-k-ink">{formatEURorDash(invoice.net)}</dd>
              </div>
              <div>
                <dt className="text-fs-12 text-k-text">{t("columns.vat")}</dt>
                <dd className="num text-k-ink">{formatEURorDash(invoice.vat)}</dd>
              </div>
              <div>
                <dt className="text-fs-12 text-k-text">{t("columns.gross")}</dt>
                <dd className="num text-k-ink">{formatEURorDash(invoice.gross)}</dd>
              </div>
            </dl>
            {invoice.ledger === "reversed" && (
              <p className="mt-s-2 text-fs-14 text-k-ink">{invoice.reversalReason ?? t("reversalNoReason")}</p>
            )}
            <p className="mt-s-2 text-fs-14 text-k-blue-deep">{t("viewLines", { count: invoice.lines.length })}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}
