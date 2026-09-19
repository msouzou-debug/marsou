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
 * CloseoutChecklist — the permit detail's «Κλείσιμο» dialog body: the five
 * §6.6 boxes, a note, and the clinical-acceptance block (UI instructions §5
 * permit detail, CAPEX-01 §6.6).
 *
 * | Prop              | Type                 | Notes                                                              |
 * |-------------------|----------------------|-----------------------------------------------------------------------|
 * | value             | CloseoutChecklist    | Fully controlled.                                                     |
 * | onChange          | (next) => void       | Fired on every box/note/acceptance change.                            |
 * | isClinicalOwner   | boolean              | RULE below.                                                           |
 * | approverName      | string               | The signed-in clinical owner's own name, used when they sign.          |
 *
 * RULE (§6.6): «Αποδοχή από κλινικό υπεύθυνο» is a checkbox only a clinical
 * owner may tick — enabled only when `isClinicalOwner` is true, and always
 * shown (never hidden) so a non-clinical requester sees who still has to
 * sign. RULE: `closeoutComplete` (`src/lib/permit-rules.ts`) — every box plus
 * the signature — is what the caller uses to enable «Ολοκλήρωση»; this
 * component only collects the values.
 *
 * State: default only.
 */
export interface CloseoutChecklistProps {
  value: CloseoutChecklistValue;
  onChange: (next: CloseoutChecklistValue) => void;
  isClinicalOwner: boolean;
  approverName: string;
  approverId: string;
}

export function CloseoutChecklist({
  value,
  onChange,
  isClinicalOwner,
  approverName,
  approverId,
}: CloseoutChecklistProps) {
  const t = useTranslations("components.closeout-checklist");

  function toggleBox(key: (typeof BOX_KEYS)[number]) {
    onChange({ ...value, [key]: !value[key] });
  }

  function toggleAcceptance(checked: boolean) {
    onChange({
      ...value,
      clinicalAcceptanceById: checked ? approverId : null,
      clinicalAcceptanceByName: checked ? approverName : null,
      clinicalAcceptanceAt: checked ? new Date().toISOString() : null,
    });
  }

  return (
    <div className="grid gap-s-4">
      <fieldset className="grid gap-s-2">
        <legend className="sr-only">{t("legend")}</legend>
        {BOX_KEYS.map((key) => (
          <label key={key} className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
            <input type="checkbox" checked={value[key]} onChange={() => toggleBox(key)} />
            {t(`boxes.${key}`)}
          </label>
        ))}
      </fieldset>

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

      <label
        className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink"
        title={isClinicalOwner ? undefined : t("notClinicalOwner")}
      >
        <input
          type="checkbox"
          checked={value.clinicalAcceptanceById !== null}
          disabled={!isClinicalOwner}
          onChange={(event) => toggleAcceptance(event.target.checked)}
        />
        {t("clinicalAcceptance")}
      </label>
      {value.clinicalAcceptanceByName && (
        <p className="text-fs-14 text-k-text">
          {t("acceptedBy", { name: value.clinicalAcceptanceByName })}
        </p>
      )}
      {!closeoutComplete(value) && <p className="text-fs-14 text-k-text">{t("incomplete")}</p>}
    </div>
  );
}
