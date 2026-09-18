import type { Metadata } from "next";
import { IBM_Plex_Mono, Lato } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { QueryProvider } from "@/data/provider";
import "./globals.css";

// Self-hosted at build time (ADR-0003). Weights 400/700 only per UI §1.
const lato = Lato({
  weight: ["400", "700"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-lato",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "eCapital",
  description: "Τα έργα, τα πάγια και η συντήρηση του ΟΚΥπΥ",
};

// The document and the providers, and nothing else. The chrome — top bar,
// nav rail, help drawer — belongs to the `(app)` group's layout, because
// `/sign-in` must render without any of it (UI instructions §6: a sign-in
// screen with a nav rail offers links nobody may follow yet).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${lato.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Nicosia">
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
