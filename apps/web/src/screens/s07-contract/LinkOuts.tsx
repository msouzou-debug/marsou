"use client";

// S07 — R08, ADR-0019 §4
//
/**
 * LinkOuts — the two links off S07 to the systems next door.
 *
 * eCapital, eMAP (procurement) and eFinance (invoices and budget) run side by
 * side on the ΟΚΥπΥ server. A contract here was usually procured over there
 * and will be invoiced over there, and a person who has the contract on
 * screen should not have to go and find it again by hand.
 *
 * | Prop     | Type            | Notes                                                |
 * |----------|-----------------|--------------------------------------------------------|
 * | contract | ContractDetail  | For `ref`, `contractNo` and `emapRef`.                   |
 * | links    | ConfigLinks?    | `GET /config/links`; undefined while it is still loading. |
 *
 * RULE (ADR-0019): neither link is ever guessed. eMAP appears only when this
 * deployment was told where eMAP is *and* the contract carries an eMAP
 * reference — `emapRef`, or a `contractNo` that is already one. eFinance
 * appears only when this deployment was told where eFinance is. A link to a
 * host we invented is worse than no link: it teaches people the button is
 * broken, and they stop pressing the ones that work.
 *
 * RULE: both open in a new tab, with `rel="noopener"` — the other system must
 * not be handed a window handle back into this one.
 *
 * State: default only. It renders nothing at all until there is something to
 * link to, which covers loading and failure alike — a missing link is the
 * right answer to "we could not find out where eMAP is".
 */
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { EMAP_CONTRACT_REF, type ConfigLinks, type ContractDetail } from "@ecapital/shared";

export interface LinkOutsProps {
  contract: ContractDetail;
  links?: ConfigLinks;
}

/**
 * The eMAP reference for this contract, or null.
 *
 * `emapRef` is the field somebody fills in on purpose. `contractNo` is
 * accepted as well because the first contracts recorded here were typed
 * before that field existed, and some of them carry the eMAP reference as
 * their number — INTEGRATION-eMAP §4's `CON-YYYY-NNNN`, exactly.
 */
export function emapReference(contract: Pick<ContractDetail, "contractNo" | "emapRef">): string | null {
  if (contract.emapRef) return contract.emapRef;
  return EMAP_CONTRACT_REF.test(contract.contractNo) ? contract.contractNo : null;
}

export function LinkOuts({ contract, links }: LinkOutsProps) {
  const t = useTranslations("screens.s07.links");
  const emapRef = emapReference(contract);
  const emapUrl = links?.emapUrl && emapRef
    ? `${links.emapUrl}/contracts?q=${encodeURIComponent(emapRef)}`
    : null;
  // TODO (ADR-0019): eFinance does not support `/invoices?contract_ref=` yet
  // — the request is recorded in ADR-0019 and has to be made to that team.
  // Until it lands, the link opens the invoice list and the clerk searches;
  // the query string is harmless where it is not read.
  const efinanceUrl = links?.efinanceUrl
    ? `${links.efinanceUrl}/invoices?contract_ref=${encodeURIComponent(contract.ref)}`
    : null;

  if (!emapUrl && !efinanceUrl) return null;

  return (
    <nav aria-label={t("label")} className="mt-s-2 flex flex-wrap gap-s-4">
      {emapUrl && (
        <a
          href={emapUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-s-2 text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
        >
          <ExternalLink size={20} strokeWidth={1.5} aria-hidden="true" />
          <span>{t("emap")}</span>
        </a>
      )}
      {efinanceUrl && (
        <a
          href={efinanceUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-s-2 text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
        >
          <ExternalLink size={20} strokeWidth={1.5} aria-hidden="true" />
          <span>{t("efinance")}</span>
        </a>
      )}
    </nav>
  );
}
