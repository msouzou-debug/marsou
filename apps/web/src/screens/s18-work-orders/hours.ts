"use client";

// S18b, S20 — R32, R33. The catalogue's hours as people say them: «30 λεπ»
// for half an hour, «2 ω», «48 ω». The i18n keys sit under
// `screens.s20.duration` because S20 is where a caller first reads them.
import { useTranslations } from "next-intl";

/** «0,5 ω» reads badly on a phone: half an hour is «30 λεπ». */
export function hoursParts(hours: number): { unit: "minutes" | "hours"; count: number } {
  if (hours < 1) return { unit: "minutes", count: Math.round(hours * 60) };
  return { unit: "hours", count: Math.round(hours * 10) / 10 };
}

export function useHours(): (hours: number) => string {
  const t = useTranslations("screens.s20.duration");
  return (hours: number) => {
    const { unit, count } = hoursParts(hours);
    return t(unit, { count });
  };
}
