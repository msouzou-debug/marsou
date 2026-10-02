// S07f — ADR-0029
//
/**
 * EFinanceLedgerChip — where one eFinance invoice stands in eCapital's books.
 *
 * | Prop   | Type            | Notes                                              |
 * |--------|-----------------|-----------------------------------------------------|
 * | ledger | EFinanceLedger  | `booked` \| `in_flight` \| `reversed` \| `rejected` |
 *
 * RULE (integration record §3, ADR-0029): only `booked` is spend. `in_flight`
 * is forecast only, `reversed` stays in the history with its reason and is
 * never summed, `rejected` never posts. The chip carries the word, never
 * colour alone (UI instructions §7), and the colour follows the same split:
 * green is the one that counts, amber is waiting, grey is history, red is a
 * refusal.
 *
 * State: default only — a value the parent already has.
 */
import { useTranslations } from "next-intl";
import type { EFinanceLedger } from "@ecapital/shared";

export const LEDGER_CHIP_CLASS: Record<EFinanceLedger, string> = {
  booked: "bg-k-green-bg",
  in_flight: "bg-k-amber-bg",
  reversed: "bg-k-grey",
  rejected: "bg-k-red-bg",
};

/** The i18n key under `screens.s07f.ledger` for each ledger. */
export const LEDGER_LABEL_KEY: Record<EFinanceLedger, string> = {
  booked: "booked",
  in_flight: "inFlight",
  reversed: "reversed",
  rejected: "rejected",
};

export interface EFinanceLedgerChipProps {
  ledger: EFinanceLedger;
}

export function EFinanceLedgerChip({ ledger }: EFinanceLedgerChipProps) {
  const t = useTranslations("screens.s07f.ledger");
  return (
    <span
      data-ledger={ledger}
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-k-chip px-s-2 text-fs-14 text-k-ink ${LEDGER_CHIP_CLASS[ledger]}`}
    >
      {t(LEDGER_LABEL_KEY[ledger])}
    </span>
  );
}
