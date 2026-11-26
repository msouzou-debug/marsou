"use client";

/**
 * RecipientFields — who a record went to, their address and the day it left
 * (owner decision 25/11/2026 for the RFI; owner request 26/11/2026 for the
 * site instruction). The same three fields on every new and edit form that
 * has them; each screen gives its own labels, because «the RFI» and «the
 * instruction» read differently in the hint.
 *
 * | Prop      | Type                         | Notes                                          |
 * |-----------|------------------------------|-------------------------------------------------|
 * | idPrefix  | string                       | `<prefix>-recipient`, `-recipient-email`, `-sent-on`. |
 * | register  | (name) => register props     | react-hook-form's `register`, narrowed to the three. |
 * | errors    | Partial<Record<key, string>> | Message keys, said in the caller's language.    |
 * | minSentOn | string?                      | yyyy-mm-dd.                                     |
 * | maxSentOn | string                       | yyyy-mm-dd, today.                              |
 * | labels    | RecipientLabels              | Already translated.                             |
 */
import type { UseFormRegisterReturn } from "react-hook-form";
import { useTranslations } from "next-intl";

export type RecipientKey = "recipientName" | "recipientEmail" | "sentOn";
export type RegisterRecipient = (name: RecipientKey) => UseFormRegisterReturn<RecipientKey>;

export interface RecipientLabels {
  name: string;
  nameHint: string;
  email: string;
  sentOn: string;
  sentOnHint: string;
}

const INPUT = "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink";

function FieldError({ message }: { message?: string }) {
  const t = useTranslations();
  return message ? (
    <p role="alert" className="text-fs-14 text-k-red">
      {t(message)}
    </p>
  ) : null;
}

export function RecipientFields({
  idPrefix,
  register,
  errors,
  minSentOn,
  maxSentOn,
  labels,
}: {
  idPrefix: string;
  register: RegisterRecipient;
  errors: Partial<Record<RecipientKey, string>>;
  minSentOn?: string;
  maxSentOn: string;
  labels: RecipientLabels;
}) {
  return (
    <>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-recipient`} className="text-fs-14 text-k-text">
          {labels.name}
        </label>
        <input
          id={`${idPrefix}-recipient`}
          type="text"
          autoComplete="off"
          {...register("recipientName")}
          aria-invalid={errors.recipientName ? "true" : undefined}
          className={INPUT}
        />
        <p className="text-fs-14 text-k-text">{labels.nameHint}</p>
        <FieldError message={errors.recipientName} />
      </div>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-recipient-email`} className="text-fs-14 text-k-text">
          {labels.email}
        </label>
        <input
          id={`${idPrefix}-recipient-email`}
          type="email"
          autoComplete="off"
          {...register("recipientEmail")}
          aria-invalid={errors.recipientEmail ? "true" : undefined}
          className={INPUT}
        />
        <FieldError message={errors.recipientEmail} />
      </div>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-sent-on`} className="text-fs-14 text-k-text">
          {labels.sentOn}
        </label>
        <input
          id={`${idPrefix}-sent-on`}
          type="date"
          min={minSentOn}
          max={maxSentOn}
          {...register("sentOn")}
          aria-invalid={errors.sentOn ? "true" : undefined}
          className={`num w-[200px] ${INPUT}`}
        />
        <p className="text-fs-14 text-k-text">{labels.sentOnHint}</p>
        <FieldError message={errors.sentOn} />
      </div>
    </>
  );
}
