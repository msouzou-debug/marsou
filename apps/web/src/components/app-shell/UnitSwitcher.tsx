"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { OrgUnit } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";

// Props:
// | Prop            | Type                      | Notes                                    |
// |------------------|---------------------------|-------------------------------------------|
// | orgUnits         | OrgUnit[]                  | the org units; caller passes real data |
// | defaultUnitId    | string?                    | pre-selects a unit, e.g. from the profile |
// | onChange         | (unitId: string) => void?  | wired to routing once S02 exists          |
export interface UnitSwitcherProps {
  orgUnits: OrgUnit[];
  defaultUnitId?: string;
  onChange?: (unitId: string) => void;
}

// RULE: the first organisational level is the org unit — nine hospitals plus
// three services — and its label is «Μονάδα», never «Νοσοκομείο» (UI
// instructions §2; CAPEX-02 §7). Hospital names appear only as the option
// values below, never as the label.
export function UnitSwitcher({ orgUnits, defaultUnitId, onChange }: UnitSwitcherProps) {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const [value, setValue] = useState(defaultUnitId ?? orgUnits[0]?.id ?? "");

  return (
    <select
      aria-label={t("unit")}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange?.(event.target.value);
      }}
      className="max-w-[180px] rounded-k border border-k-grey bg-k-white px-s-2 py-s-1 text-fs-14 text-k-text tablet:max-w-[220px]"
    >
      {orgUnits.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {locale === "en" ? unit.nameEn : unit.nameEl}
        </option>
      ))}
    </select>
  );
}
