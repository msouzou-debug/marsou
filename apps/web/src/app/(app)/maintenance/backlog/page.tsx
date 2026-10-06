// S21 «Εκκρεμότητες συντήρησης» — R35, R36 (ADR-0031 §7, §8)

import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { BacklogScreen } from "@/screens/s21-backlog/BacklogScreen";

export default async function BacklogPage() {
  const [session, orgUnits, unitCookie] = await Promise.all([getSession(), getVisibleOrgUnits(), cookies()]);
  const remembered = unitCookie.get(UNIT_COOKIE)?.value;
  const unit = remembered && orgUnits.some((u) => u.id === remembered) ? remembered : undefined;
  return (
    <>
      <BacklogScreen orgUnits={orgUnits} roles={session?.me.roles ?? []} noPermission={<NoPermission />} initialFilters={unit ? { unit } : undefined} />
      <HelpSection route="/maintenance/backlog" />
    </>
  );
}
