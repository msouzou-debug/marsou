/**
 * The three inbox facts for a SHUTDOWN item (S14, ADR-0026 §10), and the
 * role suffix on `whatEl` — pure functions of a row, kept out of
 * `inbox.service.ts` for the same reason `permit-rows.ts` is: a rule that
 * needs a database to test is a rule nobody tests.
 *
 * Review nit (19/09/2026): the facts used to read raw enum values
 * (`IV · MEDICAL_GAS`, an ISO window, an area list with no cap) straight out
 * of the row. They now go through the API's own i18n catalogues
 * (`permitSystem.*`, `approvalRole.*`, `inbox.facts.*`) so a Class IV
 * medical-gas shutdown reads «Κατηγορία IV · Ιατρικά αέρια» in Greek and
 * «Class IV · Medical gases» in English, and the window is said the way a
 * person reads a clock, not the way a database stores a timestamp.
 */
import type { ApprovalRole, IcraClass, PermitSystem } from "@ecapital/shared";
import type { I18nService, Locale } from "../common/i18n.service";

/** S14's own cap: three rooms named, the rest counted. */
const MAX_AREAS_NAMED = 3;

const WINDOW_TIME_ZONE = "Europe/Nicosia";

function nicosiaParts(date: Date): {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WINDOW_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/**
 * `dd/mm/yyyy HH:mm – dd/mm/yyyy HH:mm`, Europe/Nicosia, or
 * `dd/mm/yyyy HH:mm – HH:mm` when the window opens and closes the same local
 * day. The digits are the same in both languages (UI instructions §1), so
 * this needs no locale.
 */
export function formatPermitWindow(start: Date, end: Date): string {
  const from = nicosiaParts(start);
  const to = nicosiaParts(end);
  const fromStr = `${from.day}/${from.month}/${from.year} ${from.hour}:${from.minute}`;
  const sameDay = from.day === to.day && from.month === to.month && from.year === to.year;
  return sameDay
    ? `${fromStr} – ${to.hour}:${to.minute}`
    : `${fromStr} – ${to.day}/${to.month}/${to.year} ${to.hour}:${to.minute}`;
}

/** The rooms, joined with «, », capped at three plus «+N» for the rest. */
export function formatAreaList(namesEl: string[]): string {
  if (namesEl.length === 0) return "—";
  if (namesEl.length <= MAX_AREAS_NAMED) return namesEl.join(", ");
  const rest = namesEl.length - MAX_AREAS_NAMED;
  return `${namesEl.slice(0, MAX_AREAS_NAMED).join(", ")} +${rest}`;
}

/** One system's label in the caller's language, from `permitSystem.*`. */
export function systemLabel(system: PermitSystem, locale: Locale, i18n: I18nService): string {
  return i18n.translate(`permitSystem.${system}`, locale);
}

/** «Κατηγορία IV · Ιατρικά αέρια» / «Class IV · Medical gases». */
export function classAndSystemsFact(
  icraClass: IcraClass | null,
  systems: PermitSystem[],
  locale: Locale,
  i18n: I18nService,
): string {
  const systemNames = systems.map((system) => systemLabel(system, locale, i18n)).join(", ");
  return i18n.translate("inbox.facts.classAndSystems", locale, {
    class: icraClass ?? "—",
    systems: systemNames,
  });
}

/** One approval role's label in the caller's language, from `approvalRole.*`. */
export function approvalRoleLabel(role: ApprovalRole, locale: Locale, i18n: I18nService): string {
  return i18n.translate(`approvalRole.${role}`, locale);
}

/**
 * «PTW-NGH-2026-001 — Διακοπή ιατρικών αερίων… (ως Έλεγχος Λοιμώξεων)» — the
 * approval role appended so that a permit with several lines waiting on the
 * same caller (WARD_MANAGER for one area, NURSING for the unit) shows up as
 * three distinguishable rows rather than three identical ones.
 */
export function permitWhatEl(
  ref: string | null,
  titleEl: string,
  role: ApprovalRole,
  locale: Locale,
  i18n: I18nService,
): string {
  const base = ref ? `${ref} — ${titleEl}` : titleEl;
  const suffix = i18n.translate("inbox.facts.roleSuffix", locale, {
    role: approvalRoleLabel(role, locale, i18n),
  });
  return `${base} ${suffix}`;
}
