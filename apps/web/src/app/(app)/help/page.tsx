// S26 — R49 (partial), R50
//
// The help centre. The build brief (§6.1) and UI instructions (§5 S26)
// describe it as the searchable full manual plus the guide list; only the
// guide list is built here — the searchable manual (R49) is out of scope
// for this change and stays open, noted in docs/manual/{el,en}/S26-help-centre.md.
//
// Reached from the S25 help drawer's empty-state link (`helpCentreHref`,
// HelpDrawer.tsx) and the "?" shortcut's unwritten-section state — there is
// no separate top-bar nav item for it yet (UI instructions §5 S26 offers
// either; the drawer's link already exists).
import { getLocale, getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { loadGuidesIndex } from "@/help/load-guides-index";
import { listScreensByTier } from "@/help/list-screens-by-tier";
import type { Locale } from "@/i18n/config";
import { GuideIndexTable } from "@/screens/s26-help-centre/GuideIndexTable";
import { ScreenTierList } from "@/screens/s26-help-centre/ScreenTierList";

export default async function HelpCentrePage() {
  const t = await getTranslations("screens.s26");
  const common = await getTranslations("common");
  const locale = (await getLocale()) as Locale;
  const index = loadGuidesIndex();
  const { dayOne, optional } = listScreensByTier(locale);

  return (
    <>
      {/* UI instructions §5 S26: single column, 680px measure. */}
      <div className="mx-auto max-w-[680px]">
        <PageTitle eyebrow={common("help")} title={t("title")} />
        <p className="text-fs-16 leading-[1.6] text-k-text">{t("intro")}</p>
        {/* Owner decision 20/09/2026 (docs/briefs/README.md Errata "Screen
            tiers"): the screen list by training tier sits above the guide
            downloads, since it explains what the guides below cover. */}
        <div className="mt-s-8">
          <ScreenTierList dayOne={dayOne} optional={optional} />
        </div>
        <div className="mt-s-8">
          <GuideIndexTable guides={index?.guides ?? []} generatedAt={index?.generatedAt ?? ""} />
        </div>
      </div>
      <HelpSection route="/help" />
    </>
  );
}
