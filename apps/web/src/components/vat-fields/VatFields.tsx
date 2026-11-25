import { forwardRef, type SelectHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { VAT_RATES, VAT_RATE_VALUE, vatBreakdown, type VatRate } from "@ecapital/shared";
import { formatEUR } from "@/lib/format";

/**
 * The VAT pieces every money form and table shares (ADR-0038, owner decision
 * item 23: «amounts should be with VAT across the tool»). A commitment is
 * typed as its NET amount with a VAT rate beside it; VAT and gross are
 * worked out, never typed.
 *
 * VatRateSelect — the «Συντελεστής ΦΠΑ» select. Takes every `<select>` prop,
 * so `{...register("vatRate")}` from react-hook-form spreads straight in.
 *
 * | Prop      | Type                         | Notes                                              |
 * |-----------|------------------------------|----------------------------------------------------|
 * | id        | string                       | Required: the label points at it.                  |
 * | hideLabel | boolean?                     | When the caller draws its own label.               |
 * | …select   | SelectHTMLAttributes         | value/onChange or a react-hook-form `register`.    |
 *
 * VatSummary — «Ποσό ΦΠΑ» and «Σύνολο με ΦΠΑ» under a net amount field,
 * worked out live as the person types, with the same rounding the database
 * stores (`vatOf` in packages/shared).
 *
 * | Prop  | Type          | Notes                                                        |
 * |-------|---------------|--------------------------------------------------------------|
 * | net   | number \| null | The net typed so far; null or NaN shows «—».                |
 * | rate  | VatRate       |                                                              |
 * | id    | string?       | For `aria-describedby` from the net input.                  |
 *
 * GrossAmount — a gross figure in a table cell, with the net and the VAT in
 * its tooltip and its accessible name, so the main figure is the one budget
 * control uses and the net is one hover away.
 *
 * | Prop  | Type    | Notes |
 * |-------|---------|-------|
 * | gross | number  |       |
 * | net   | number  |       |
 * | vat   | number  |       |
 *
 * State: default only. Each piece shows a value its parent holds; there is
 * nothing to load.
 */

/** The rate as the fraction the export writes as a percentage (0.19). */
export function vatRateFraction(rate: VatRate): number {
  return VAT_RATE_VALUE[rate];
}

export interface VatRateSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  id: string;
  hideLabel?: boolean;
}

export const VatRateSelect = forwardRef<HTMLSelectElement, VatRateSelectProps>(function VatRateSelect(
  { id, hideLabel, className, ...rest },
  ref,
) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-s-1">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-fs-14 text-k-text"}>
        {t("components.vat-fields.rate")}
      </label>
      <select
        id={id}
        ref={ref}
        {...rest}
        className={
          className ?? "h-11 w-[160px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        }
      >
        {VAT_RATES.map((rate) => (
          <option key={rate} value={rate}>
            {t(`vatRates.${rate}`)}
          </option>
        ))}
      </select>
    </div>
  );
});

export interface VatSummaryProps {
  net: number | null;
  rate: VatRate;
  id?: string;
}

export function VatSummary({ net, rate, id }: VatSummaryProps) {
  const t = useTranslations("components.vat-fields");
  const known = net !== null && Number.isFinite(net);
  const figures = known ? vatBreakdown(net, rate) : null;
  return (
    // RULE (ADR-0038): live, so the person sees the gross they are about to
    // commit before they save; polite, so a screen reader is not interrupted
    // on every keystroke.
    <dl id={id} aria-live="polite" className="flex flex-wrap gap-x-s-5 gap-y-s-1 text-fs-14 text-k-text">
      <div className="flex gap-s-2">
        <dt>{t("vat")}</dt>
        <dd className="num text-k-ink" data-testid="vat-amount">
          {figures ? formatEUR(figures.vat) : "—"}
        </dd>
      </div>
      <div className="flex gap-s-2">
        <dt>{t("gross")}</dt>
        <dd className="num font-bold text-k-ink" data-testid="vat-gross">
          {figures ? formatEUR(figures.gross) : "—"}
        </dd>
      </div>
    </dl>
  );
}

export interface GrossAmountProps {
  gross: number;
  net: number;
  vat: number;
}

export function GrossAmount({ gross, net, vat }: GrossAmountProps) {
  const t = useTranslations("components.vat-fields");
  const detail = t("breakdown", { net: formatEUR(net), vat: formatEUR(vat) });
  return (
    <span title={detail} aria-label={`${formatEUR(gross)} (${detail})`}>
      {formatEUR(gross)}
    </span>
  );
}
