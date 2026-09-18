export const locales = ["el", "en"] as const;
export type Locale = (typeof locales)[number];
// RULE: Greek is the default and the language of record (CAPEX-01 §6.1, R43).
export const defaultLocale: Locale = "el";
export const LOCALE_COOKIE = "ecapital_locale";

export function isLocale(value: unknown): value is Locale {
  return locales.includes(value as Locale);
}
