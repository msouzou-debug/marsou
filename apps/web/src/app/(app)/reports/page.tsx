// S23 «Αναφορές» — M6, not built yet as a screen of its own.
//
// Same reasoning as /maintenance: the nav item has been there since M0 and
// a 404 behind it reads as a fault. Until S23 exists, this page is the
// index of the figures and exports the system already produces, each on
// the screen that owns it, plus what S23 will add.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";

const TODAY_LINKS = [
  { key: "portfolio", href: "/" },
  { key: "projects", href: "/projects" },
  { key: "accruals", href: "/cost/accruals" },
  { key: "forecast", href: "/assets/forecast" },
  { key: "calendar", href: "/calendar" },
  { key: "contracts", href: "/contracts" },
] as const;

export default async function ReportsPage() {
  const t = await getTranslations("screens.s23");
  const nav = await getTranslations("nav");
  return (
    <>
      <div className="mx-auto max-w-[680px]">
        <PageTitle eyebrow={nav("reports")} title={t("title")} />
        <p className="text-fs-16 leading-[1.6] text-k-text">{t("intro")}</p>
        <h2 className="mt-s-6 text-fs-16 font-bold text-k-ink">{t("todayTitle")}</h2>
        <ul className="mt-s-2 flex flex-col gap-s-2">
          {TODAY_LINKS.map((link) => (
            <li key={link.key}>
              <Link href={link.href} className="text-fs-16 text-k-blue underline-offset-2 hover:underline">
                {t(`today.${link.key}.label`)}
              </Link>
              <span className="text-fs-14 text-k-text"> {t(`today.${link.key}.what`)}</span>
            </li>
          ))}
        </ul>
        <h2 className="mt-s-6 text-fs-16 font-bold text-k-ink">{t("comingTitle")}</h2>
        <ul className="mt-s-2 list-disc pl-s-5 text-fs-16 leading-[1.6] text-k-text">
          <li>{t("coming.backlog")}</li>
          <li>{t("coming.lifecycle")}</li>
          <li>{t("coming.directorate")}</li>
          <li>{t("coming.exports")}</li>
        </ul>
      </div>
      <HelpSection route="/reports" />
    </>
  );
}
