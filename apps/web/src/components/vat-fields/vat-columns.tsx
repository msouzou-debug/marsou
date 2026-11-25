import { VAT_RATE_VALUE, type VatRate } from "@ecapital/shared";
import type { TableColumn } from "@/components/table";
import { formatEUR } from "@/lib/format";

/**
 * ADR-0038: the four columns every table of commitments shows the same way —
 * «Καθαρό ποσό», «Συντελεστής ΦΠΑ», «Ποσό ΦΠΑ» and, in bold, «Σύνολο με ΦΠΑ».
 * The export writes the rate as a percentage, the VAT as `=ROUND(net*rate,2)`
 * and the gross as `=net+vat`, live (`exportFormula`).
 *
 * `idPrefix` keeps the ids unique when a table shows two sets.
 */
export interface VatColumnsInput<T> {
  net: (row: T) => number;
  rate: (row: T) => VatRate;
  vat: (row: T) => number;
  gross: (row: T) => number;
  /** The rate's label, e.g. `t(\`vatRates.${rate}\`)`. */
  rateLabel: (rate: VatRate) => string;
  idPrefix?: string;
  /** Header keys; the component's own by default. */
  netHeaderKey?: string;
  /** Red when negative (an omission). */
  signed?: boolean;
}

export function vatColumns<T>({
  net,
  rate,
  vat,
  gross,
  rateLabel,
  idPrefix = "",
  netHeaderKey = "components.vat-fields.net",
  signed = false,
}: VatColumnsInput<T>): TableColumn<T>[] {
  const id = (name: string) => (idPrefix ? `${idPrefix}${name[0].toUpperCase()}${name.slice(1)}` : name);
  const tone = (value: number) => (signed && value < 0 ? "text-k-red" : undefined);
  return [
    {
      id: id("net"),
      headerKey: netHeaderKey,
      accessor: net,
      numeric: true,
      exportKind: "money",
      cell: (row) => <span className={tone(net(row))}>{formatEUR(net(row))}</span>,
    },
    {
      id: id("vatRate"),
      headerKey: "components.vat-fields.rate",
      // The fraction, so the export writes 19% and the formula can use it.
      accessor: (row) => VAT_RATE_VALUE[rate(row)],
      numeric: true,
      exportKind: "percent",
      cell: (row) => rateLabel(rate(row)),
    },
    {
      id: id("vat"),
      headerKey: "components.vat-fields.vat",
      accessor: vat,
      numeric: true,
      exportKind: "money",
      exportFormula: { op: "multiply", columns: [id("net"), id("vatRate")] },
      cell: (row) => <span className={tone(vat(row))}>{formatEUR(vat(row))}</span>,
    },
    {
      id: id("gross"),
      headerKey: "components.vat-fields.gross",
      accessor: gross,
      numeric: true,
      exportKind: "money",
      exportFormula: { op: "add", columns: [id("net"), id("vat")] },
      cell: (row) => <span className={`font-bold ${tone(gross(row)) ?? ""}`}>{formatEUR(gross(row))}</span>,
    },
  ];
}
