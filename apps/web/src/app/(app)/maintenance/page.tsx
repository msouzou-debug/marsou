// S18 «Συντήρηση» — M5 (R32–R37), not built yet.
//
// The nav rail has carried «Συντήρηση» since M0 (UI instructions §2, fixed
// order), and until M5 the link answered 404, which a tester reads as a
// fault. This page says what the area will hold, which milestone brings it,
// and where the maintenance facts that do exist today live: the asset
// register (condition, readings, replacement forecast), the defects on a
// contract, and the permits. It is deliberately a page and not a redirect,
// so the nav item stays honest.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";

const TODAY_LINKS = [
  { key: "assets", href: "/assets" },
  { key: "forecast", href: "/assets/forecast" },
  { key: "contracts", href: "/contracts" },
  { key: "permits", href: "/permits" },
] as const;

export default async function MaintenancePage() {
  const t = await getTranslations("screens.s18");
  const nav = await getTranslations("nav");
  return (
    <>
      <div className="mx-auto max-w-[680px]">
        <PageTitle eyebrow={nav("maintenance")} title={t("title")} />
        <p className="text-fs-16 leading-[1.6] text-k-text">{t("intro")}</p>
        <h2 className="mt-s-6 text-fs-16 font-bold text-k-ink">{t("comingTitle")}</h2>
        <ul className="mt-s-2 list-disc pl-s-5 text-fs-16 leading-[1.6] text-k-text">
          <li>{t("coming.workOrders")}</li>
          <li>{t("coming.ppm")}</li>
          <li>{t("coming.backlog")}</li>
          <li>{t("coming.mobile")}</li>
        </ul>
        <h2 className="mt-s-6 text-fs-16 font-bold text-k-ink">{t("todayTitle")}</h2>
        <ul className="mt-s-2 flex flex-col gap-s-2">
          {TODAY_LINKS.map((link) => (
            <li key={link.key}>
              <Link href={link.href} className="text-fs-16 text-k-blue underline-offset-2 hover:underline">
                {t(`today.${link.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <HelpSection route="/maintenance" />
    </>
  );
}
