import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";

// Locale comes from a cookie, not the URL (ADR-0002). Same URLs in both
// languages; the toggle switches without a route change.
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : defaultLocale;
  return {
    locale,
    messages: (await import(`./${locale}.json`)).default,
    timeZone: "Europe/Nicosia",
  };
});
