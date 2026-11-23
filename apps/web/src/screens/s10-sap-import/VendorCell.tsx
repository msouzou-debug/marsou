// S10 — ADR-0036
//
// The vendor name of a cost line with, under it, a small mono line for the
// SAP vendor number and the contract reference when the line carries them,
// and how the line was matched when it was (CONTRACT_REF, EFINANCE_INVOICE…).
import { useTranslations } from "next-intl";
import type { CostTxn } from "@ecapital/shared";

export function VendorCell({ txn, fallback }: { txn: CostTxn; fallback: string }) {
  const t = useTranslations();
  const ids = [txn.vendorNo, txn.contractRef].filter((v): v is string => !!v);
  const matched = txn.matchedBy !== "NONE";
  return (
    <span className="block">
      <span className="block">{txn.vendorName ?? fallback}</span>
      {ids.length > 0 && <span className="block font-k-mono text-fs-12 text-k-text">{ids.join(" · ")}</span>}
      {matched && <span className="block text-fs-12 text-k-text">{t(`matchedBy.${txn.matchedBy}`)}</span>}
    </span>
  );
}
