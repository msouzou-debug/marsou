import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import el from "@/i18n/el.json";
import en from "@/i18n/en.json";
import type { Locale } from "@/i18n/config";

const messages = { el, en } as const;

// Test helper: render with the i18n provider in either language.
export function renderWithIntl(
  ui: ReactElement,
  { locale = "el", ...options }: RenderOptions & { locale?: Locale } = {},
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Europe/Nicosia">
      {ui}
    </NextIntlClientProvider>,
    options,
  );
}
