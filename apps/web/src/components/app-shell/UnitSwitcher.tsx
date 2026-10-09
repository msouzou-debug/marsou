"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import type { OrgUnit } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";

// Props:
// | Prop            | Type                              | Notes                                          |
// |------------------|-----------------------------------|-------------------------------------------------|
// | orgUnits         | OrgUnit[]                         | the caller's own units, from GET /org-units      |
// | defaultUnitId    | string?                           | pre-selects a unit, from the ecapital_unit cookie|
// | onSelect         | (id: string) => Promise<void>?     | server action that remembers the choice          |
// | onChange         | (id: string) => void?              | extra hook for callers that need the raw event   |
/** The switcher value that means «every unit I can see» (owner ask, 05/10/2026). */
export const ALL_UNITS = "all";

export interface UnitSwitcherProps {
  orgUnits: OrgUnit[];
  defaultUnitId?: string;
  onSelect?: (unitId: string) => Promise<void>;
  onChange?: (unitId: string) => void;
}

// RULE: the first organisational level is the org unit — eight hospitals,
// three services and, since owner decision 19/09/2026, Central
// Administration itself (HQ) — and its label is «Μονάδα», never
// «Νοσοκομείο» (UI instructions §2; CAPEX-02 §7). Hospital names appear only
// as the option values below, never as the label.
//
// RULE (R01): the options are whatever `GET /org-units` returned for this
// caller. Switching to a unit is not a permission check — the screen it opens
// asks the API, and the API answers 404 for anything outside their access
// (ADR-0010).
//
// Owner ask, 05/10/2026: the switcher is a filter. A caller who sees more
// than one unit also gets «ΟΚΥπΥ — όλες οι μονάδες» as the first option,
// which is the whole-organisation view (the portfolio). Picking a unit opens
// the project list filtered to it. A caller with one unit sees that unit and
// nothing else, as before.
export function UnitSwitcher({ orgUnits, defaultUnitId, onSelect, onChange }: UnitSwitcherProps) {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const offersAll = orgUnits.length > 1;
  const [value, setValue] = useState(defaultUnitId ?? (offersAll ? ALL_UNITS : (orgUnits[0]?.id ?? "")));

  return (
    <select
      aria-label={t("unit")}
      value={value}
      disabled={orgUnits.length === 0}
      onChange={(event) => {
        const unitId = event.target.value;
        setValue(unitId);
        onChange?.(unitId);
        startTransition(async () => {
          await onSelect?.(unitId);
          // RULE (owner, 09/10/2026): switching the unit keeps you on the screen
          // you are on. The cookie is already set by onSelect; the URL carries
          // the unit for the screens that read it (projects, assets,
          // maintenance), and a full navigation remounts the screen so every
          // filter starts from the new unit instead of the old state.
          const target = unitId === ALL_UNITS ? pathname : `${pathname}?unit=${encodeURIComponent(unitId)}`;
          // A full navigation, not router.push: the list screens keep their
          // filters in client state seeded once from the URL or the cookie,
          // and only a fresh load reseeds them.
          window.location.assign(target);
        });
      }}
      className="max-w-[124px] rounded-k border border-k-grey bg-k-white px-s-2 py-s-1 text-fs-14 text-k-text tablet:max-w-[320px]"
    >
      {offersAll ? <option value={ALL_UNITS}>{t("allOkypy")}</option> : null}
      {orgUnits.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {locale === "en" ? unit.nameEn : unit.nameEl}
        </option>
      ))}
    </select>
  );
}
