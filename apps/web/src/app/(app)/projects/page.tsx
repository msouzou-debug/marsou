// S02 — R03, R06, R07

import type { OrgUnit } from "@ecapital/shared";
import { getLocale, getTranslations } from "next-intl/server";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import type { Locale } from "@/i18n/config";
import { ProjectsScreen } from "@/screens/s02-projects/ProjectsScreen";

// RULE (UI instructions §5): the eyebrow gives unit context without implying
// the list itself is scoped to one unit — a caller who only ever sees one
// org unit gets its name (the "Μονάδα" cookie is that unit anyway); a caller
// who sees more than one gets «Όλες οι μονάδες», since S02 lists across every
// visible unit until a Μονάδα filter narrows it.
function unitContextEyebrow(orgUnits: OrgUnit[], locale: Locale, allUnitsLabel: string): string {
  if (orgUnits.length === 1) {
    return locale === "en" ? orgUnits[0].nameEn : orgUnits[0].nameEl;
  }
  return allUnitsLabel;
}

export default async function ProjectsPage() {
  const [orgUnits, t, locale] = await Promise.all([getVisibleOrgUnits(), getTranslations(), getLocale()]);
  const eyebrow = unitContextEyebrow(orgUnits, locale as Locale, t("common.allUnits"));

  return (
    <>
      <ProjectsScreen orgUnits={orgUnits} eyebrow={eyebrow} noPermission={<NoPermission />} />
      <HelpSection route="/projects" />
    </>
  );
}
