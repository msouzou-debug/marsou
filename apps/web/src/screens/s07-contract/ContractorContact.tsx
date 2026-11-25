"use client";

// S07 — R08 (owner UAT 25/11/2026)
//
/**
 * ContractorContact — the contract page's contractor block: the company,
 * and who to write to there (contact person, e-mail, telephone) from the
 * contractor register (S24). The e-mail is a `mailto:` link: eCapital sends
 * no e-mail itself (owner decision 25/11/2026). A contact filled from the
 * eFinance vendor master says so. Read-only here; it is edited on S24.
 *
 * | Prop       | Type       | Notes                         |
 * |------------|------------|-------------------------------|
 * | contractor | Contractor | `ContractDetail.contractor`.  |
 */
import { useTranslations } from "next-intl";
import type { Contractor } from "@ecapital/shared";

export interface ContractorContactProps {
  contractor: Contractor;
}

export function ContractorContact({ contractor }: ContractorContactProps) {
  const t = useTranslations("screens.s07.contractor");
  const hasContact = !!(contractor.contactName || contractor.contactEmail || contractor.contactPhone);

  return (
    <section aria-labelledby="s07-contractor-title" className="grid gap-s-2 rounded-k border border-k-grey bg-k-white p-s-3 text-fs-14">
      <h2 id="s07-contractor-title" className="text-fs-16 font-bold text-k-blue-deep">
        {t("title")}
      </h2>
      <p className="text-k-ink">{contractor.name}</p>
      {hasContact ? (
        <dl className="grid gap-s-2">
          {contractor.contactName && (
            <div className="flex items-baseline justify-between gap-s-3">
              <dt className="text-k-text">{t("contactName")}</dt>
              <dd className="text-right text-k-ink">{contractor.contactName}</dd>
            </div>
          )}
          {contractor.contactEmail && (
            <div className="flex items-baseline justify-between gap-s-3">
              <dt className="text-k-text">{t("contactEmail")}</dt>
              <dd className="min-w-0 break-all text-right">
                <a href={`mailto:${contractor.contactEmail}`} className="text-k-blue underline">
                  {contractor.contactEmail}
                </a>
              </dd>
            </div>
          )}
          {contractor.contactPhone && (
            <div className="flex items-baseline justify-between gap-s-3">
              <dt className="text-k-text">{t("contactPhone")}</dt>
              <dd className="num text-right text-k-ink">{contractor.contactPhone}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-k-text">{t("noContact")}</p>
      )}
      {hasContact && contractor.contactSource === "EFINANCE" && <p className="text-k-text">{t("fromEfinance")}</p>}
    </section>
  );
}
