"use client";

import { useTranslations } from "next-intl";
import type { CloseoutChecklist as CloseoutChecklistValue } from "@ecapital/shared";
import { closeoutComplete } from "@/lib/permit-rules";

const BOX_KEYS = [
  "barriersRemoved",
  "areaCleaned",
  "airBalanceRestored",
  "systemsTestedAndReturned",
  "fireSystemsReenabled",
] as const;

/**
 * CloseoutChecklist — the five §6.6 boxes and a note: the body of the permit
 * detail's «Ολοκλήρωση εργασιών» dialog, and, read-only, of the clinical
 * owner's «Αποδοχή και κλείσιμο» dialog (UI instructions §5 permit detail,
 * CAPEX-01 §6.6).
 *
 * | Prop      | Type               | Notes                                                    |
 * |-----------|--------------------|----------------------------------------------------------|
 * | value     | CloseoutChecklist  | Fully controlled.                                        |
 * | onChange  | (next) => void     | Fired on every box/note change. Not called when read-only.|
 * | readOnly  | boolean?           | The submitted checklist, as the clinical owner reads it.  |
 *
 * RULE (OWNER 26/11/2026, the handback in two steps): the works side ticks
 * the boxes and submits; the clinical owner accepts with a button of their
 * own, and the API stamps the acceptance from whoever pressed it. So there is
 * no acceptance checkbox here any more — a signature somebody else can tick
 * on your behalf is not one. The sentence under the boxes says who signs.
 * RULE: `closeoutComplete` (`src/lib/permit-rules.ts`), every box, is what
 * the caller uses to enable «Υποβολή για αποδοχή»; this component only
 * collects the values.
 *
 * State: default only.
 */
export interface CloseoutChecklistProps {
  value: CloseoutChecklistValue;
  onChange: (next: CloseoutChecklistValue) => void;
  readOnly?: boolean;
}

export function CloseoutChecklist({ value, onChange, readOnly = false }: CloseoutChecklistProps) {
  const t = useTranslations("components.closeout-checklist");

  function toggleBox(key: (typeof BOX_KEYS)[number]) {
    onChange({ ...value, [key]: !value[key] });
  }

  return (
    <div className="grid gap-s-4">
      <fieldset className="grid gap-s-2">
        <legend className="sr-only">{t("legend")}</legend>
        {BOX_KEYS.map((key) => (
          <label key={key} className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
            <input type="checkbox" checked={value[key]} disabled={readOnly} onChange={() => toggleBox(key)} />
            {t(`boxes.${key}`)}
          </label>
        ))}
      </fieldset>

      {readOnly ? (
        value.noteEl && (
          <div className="flex flex-col gap-s-1">
            <p className="text-fs-14 text-k-text">{t("noteLabel")}</p>
            <p className="text-fs-14 text-k-ink">{value.noteEl}</p>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-s-1">
          <label htmlFor="closeout-note" className="text-fs-14 text-k-text">
            {t("noteLabel")}
          </label>
          <textarea
            id="closeout-note"
            value={value.noteEl ?? ""}
            onChange={(event) => onChange({ ...value, noteEl: event.target.value || null })}
            rows={3}
            className="rounded-k border border-k-grey p-s-3 text-fs-14"
          />
        </div>
      )}

      {value.clinicalAcceptanceByName ? (
        <p className="text-fs-14 text-k-text">{t("acceptedBy", { name: value.clinicalAcceptanceByName })}</p>
      ) : (
        !readOnly && <p className="text-fs-14 text-k-text">{t("whoSigns")}</p>
      )}
      {!readOnly && !closeoutComplete(value) && <p className="text-fs-14 text-k-text">{t("incomplete")}</p>}
    </div>
  );
}
