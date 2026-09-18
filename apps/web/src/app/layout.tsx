import type { Metadata } from "next";
import { IBM_Plex_Mono, Lato } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${lato.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Nicosia">
          <QueryProvider>
            <AppShell>{children}</AppShell>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
