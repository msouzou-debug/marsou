"use client";

import { useLocale, useTranslations } from "next-intl";
import type { IcraControl } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";

/**
 * ControlsChecklist — S12 step 3's mandatory-controls list: read-only, one
 * «Ενημερώθηκα» checkbox per control (UI instructions §5 S12).
 *
 * | Prop             | Type            | Notes                                                              |
 * |------------------|-----------------|-----------------------------------------------------------------------|
 * | controls         | IcraControl[]   | From `IcraResult.controls`, in the order the matrix version stores.     |
 * | acknowledgedIds  | string[]        | Which control ids the requester has ticked — fully controlled.          |
 * | onToggle         | (id: string) => void | Fired when a checkbox changes.                                     |
 *
 * RULE (UI instructions §5 S12): the control text itself is never editable,
 * only acknowledged — there is no prop to change `textEl`/`textEn`, and the
 * gate this feeds (`allControlsAcknowledged`, `src/lib/permit-rules.ts`) is
 * what disables Υποβολή until every id here is ticked.
 *
 * State: default only — the caller already has the controls once
 * `/icra/evaluate` answered.
 */
export interface ControlsChecklistProps {
  controls: IcraControl[];
  acknowledgedIds: string[];
  onToggle: (id: string) => void;
}

export function ControlsChecklist({ controls, acknowledgedIds, onToggle }: ControlsChecklistProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const acknowledged = new Set(acknowledgedIds);

  if (controls.length === 0) {
    return <p className="text-fs-14 text-k-text">{t("components.controls-checklist.empty")}</p>;
  }

  const during = controls.filter((c) => c.phase === "DURING");
  const onCompletion = controls.filter((c) => c.phase === "ON_COMPLETION");

  function group(title: string, items: IcraControl[]) {
    if (items.length === 0) return null;
    return (
      <div key={title}>
        <p className="text-fs-12 font-bold uppercase tracking-wide text-k-text-muted eyebrow">{title}</p>
        <ul className="mt-s-2 flex flex-col gap-s-2">
          {items.map((control) => (
            <li key={control.id} className="flex items-start gap-s-3 rounded-k border border-k-grey p-s-3">
              <p className="flex-1 text-fs-14 text-k-ink">{locale === "en" ? control.textEn : control.textEl}</p>
              <label className="flex min-h-[44px] shrink-0 items-center gap-s-2 text-fs-14 text-k-text">
                <input
                  type="checkbox"
                  checked={acknowledged.has(control.id)}
                  onChange={() => onToggle(control.id)}
                />
                {t("components.controls-checklist.acknowledge")}
              </label>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="grid gap-s-4">
      {group(t("components.controls-checklist.during"), during)}
      {group(t("components.controls-checklist.onCompletion"), onCompletion)}
    </div>
  );
}
