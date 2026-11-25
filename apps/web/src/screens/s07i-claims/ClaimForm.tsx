"use client";

// S07i — ADR-0035
//
// The add and edit panel for one claim.
//
// | Prop      | Type                                  | Notes                                                   |
// |-----------|---------------------------------------|---------------------------------------------------------|
// | claim     | ContractClaim?                        | Absent for a new claim.                                  |
// | awardDate | string?                               | The contract's; a claim is not notified before it.       |
// | saving    | boolean                               | The save, and the upload after it, are in flight.        |
// | apiError  | string?                               | The API's own sentence.                                  |
// | onSave    | (values, attachment?) => void         | The claim, then the paper picked here, if any.           |
// | onCancel  | () => void                            |                                                         |
//
// RULE (date sanity): «Ημερομηνία κοινοποίησης» is not after today and not
// before the award (`schema.ts`); the date picker stops at today as well.
// `noValidate`: the browser's own bubble would otherwise stand in front of
// the sentence under the field, in the browser's language, not ours.
//
// The papers (0029): the claim's filed letters are listed with a link each,
// and one more can be picked here — the letter or e-mail that made the
// claim, the reply, or a lawyer's letter. It is filed with eArchive when the
// claim is saved, so a new claim and its letter go in with one «Αποθήκευση».
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import {
  ClaimDirection,
  ClaimDocumentKind,
  ClaimStage,
  nicosiaDateOf,
  type ContractClaim,
} from "@ecapital/shared";
import { documentContentHref } from "@/data/queries";
import { formatDate } from "@/lib/format";
import { zodResolver } from "@/lib/zod-resolver";
import { claimFormSchema, type ClaimAttachment, type ClaimFormValues } from "./schema";

export interface ClaimFormProps {
  claim?: ContractClaim;
  awardDate?: string;
  saving: boolean;
  apiError?: string;
  onSave: (values: ClaimFormValues, attachment?: ClaimAttachment) => void;
  onCancel: () => void;
}

const INPUT = "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink";

// eArchive's whitelist, as far as a letter goes: PDF, Word, an e-mail saved
// from Outlook or any mail client, a scan.
const ACCEPT =
  "application/pdf,.pdf,.doc,.docx,message/rfc822,.eml,application/vnd.ms-outlook,.msg,image/*,text/plain,.txt";

export function ClaimForm({ claim, awardDate, saving, apiError, onSave, onCancel }: ClaimFormProps) {
  const t = useTranslations();
  const today = nicosiaDateOf();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClaimFormValues>({
    resolver: zodResolver<ClaimFormValues>(claimFormSchema(awardDate)),
    defaultValues: {
      direction: claim?.direction ?? "BY_CONTRACTOR",
      titleEl: claim?.titleEl ?? "",
      amount: claim?.amount ?? (undefined as unknown as number),
      stage: claim?.stage ?? "NOTIFIED",
      notifiedAt: claim?.notifiedAt ?? "",
      legalAdvisorEl: claim?.legalAdvisorEl ?? "",
      contingentLiability: claim?.contingentLiability ?? false,
      notesEl: claim?.notesEl ?? "",
    },
  });
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ClaimDocumentKind>("CLAIM_LETTER");
  const [paperTitle, setPaperTitle] = useState("");

  const P = "screens.s07i.fields";
  const D = "screens.s07i.documents";
  const err = (key: keyof ClaimFormValues): string | undefined => {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  };
  const title = claim ? t("screens.s07i.editTitle") : t("screens.s07i.addTitle");
  const papers = claim?.documents ?? [];

  return (
    <section role="dialog" aria-label={title} className="mb-s-6 max-w-[640px] rounded-k border border-k-grey bg-k-white p-s-5 shadow-k">
      <h2 className="text-fs-20">{title}</h2>
      <form
        noValidate
        onSubmit={handleSubmit((values) =>
          file ? onSave(values, { file, kind, titleEl: paperTitle.trim() }) : onSave(values),
        )}
        className="mt-s-4 flex flex-col gap-s-4"
      >
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-direction" className="text-fs-14 text-k-text">{t(`${P}.direction`)}</label>
            <select id="cl-direction" {...register("direction")} className={INPUT}>
              {ClaimDirection.options.map((o) => (
                <option key={o} value={o}>{t(`claimDirection.${o}`)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-stage" className="text-fs-14 text-k-text">{t(`${P}.stage`)}</label>
            <select id="cl-stage" {...register("stage")} className={INPUT}>
              {ClaimStage.options.map((o) => (
                <option key={o} value={o}>{t(`claimStage.${o}`)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cl-title" className="text-fs-14 text-k-text">{t(`${P}.title`)}</label>
          <input id="cl-title" {...register("titleEl")} aria-invalid={errors.titleEl ? "true" : undefined} className={INPUT} />
          {err("titleEl") && <p role="alert" className="text-fs-14 text-k-red">{err("titleEl")}</p>}
        </div>
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-amount" className="text-fs-14 text-k-text">{t(`${P}.amount`)}</label>
            <input
              id="cl-amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              {...register("amount", { setValueAs: (value: string) => (value === "" || value == null ? NaN : Number(value)) })}
              aria-invalid={errors.amount ? "true" : undefined}
              className={`num ${INPUT}`}
            />
            {err("amount") && <p role="alert" className="text-fs-14 text-k-red">{err("amount")}</p>}
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-notified" className="text-fs-14 text-k-text">{t(`${P}.notifiedAt`)}</label>
            {/* RULE (date sanity): not after today, not before the award. */}
            <input
              id="cl-notified"
              type="date"
              max={today}
              min={awardDate || undefined}
              {...register("notifiedAt")}
              aria-invalid={errors.notifiedAt ? "true" : undefined}
              className={INPUT}
            />
            {err("notifiedAt") && <p role="alert" className="text-fs-14 text-k-red">{err("notifiedAt")}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cl-advisor" className="text-fs-14 text-k-text">{t(`${P}.legalAdvisor`)}</label>
          <input id="cl-advisor" {...register("legalAdvisorEl")} className={INPUT} />
        </div>
        <div className="flex flex-col gap-s-1">
          <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
            <input type="checkbox" {...register("contingentLiability")} />
            {t(`${P}.contingent`)}
          </label>
          <p className="text-fs-12 text-k-text">{t(`${P}.contingentHint`)}</p>
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cl-notes" className="text-fs-14 text-k-text">{t(`${P}.notes`)}</label>
          <textarea id="cl-notes" rows={3} {...register("notesEl")} className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink" />
        </div>

        <fieldset className="flex flex-col gap-s-3 rounded-k border border-k-grey p-s-4" data-testid="claim-documents">
          <legend className="px-s-1 text-fs-16 text-k-ink">{t(`${D}.title`)}</legend>
          {papers.length === 0 ? (
            <p className="text-fs-14 text-k-text">{t(`${D}.none`)}</p>
          ) : (
            <ul className="grid gap-s-2">
              {papers.map((paper) => (
                <li key={paper.documentId} className="flex flex-wrap items-baseline justify-between gap-s-2 text-fs-14">
                  <span>
                    <span className="text-k-ink">{t(`claimDocumentKind.${paper.kind}`)}</span>
                    <span className="text-k-text"> · {paper.titleEl} · {formatDate(paper.filedAt)}</span>
                    <span className="block text-fs-12 text-k-text">
                      {paper.protocolNumber
                        ? t(`${D}.protocol`, { number: paper.protocolNumber })
                        : t(`${D}.queued`)}
                    </span>
                  </span>
                  <a
                    href={documentContentHref(paper.documentId)}
                    target="_blank"
                    rel="noopener"
                    className="text-k-blue-deep underline-offset-2 hover:underline"
                  >
                    {t("buttons.open")}
                    <span className="sr-only"> {paper.titleEl}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-fs-14 text-k-text">{t(`${D}.attachHint`)}</p>
          <div className="grid gap-s-3 tablet:grid-cols-2">
            <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
              {t(`${D}.kind`)}
              <select value={kind} onChange={(e) => setKind(e.target.value as ClaimDocumentKind)} className={INPUT}>
                {ClaimDocumentKind.options.map((o) => (
                  <option key={o} value={o}>{t(`claimDocumentKind.${o}`)}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
              {t(`${D}.paperTitle`)}
              <input value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)} className={INPUT} />
            </label>
          </div>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t(`${D}.file`)}
            <input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-fs-14" />
          </label>
        </fieldset>

        {apiError && (
          <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">{apiError}</p>
        )}
        <div className="flex flex-wrap items-center gap-s-3">
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("buttons.save")}
          </button>
          <button type="button" onClick={onCancel} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text">
            {t("buttons.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}
