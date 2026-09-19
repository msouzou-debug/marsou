// S24 — R08

import { getTranslations } from "next-intl/server";
import { getSession } from "@/auth/session";
import { canManageContractors, isAdmin } from "@/auth/roles";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ContractorsScreen } from "@/screens/s24-contractors/ContractorsScreen";

// Server Component. RULE (ADR-0015 "Who keeps the contractor register",
// decided 19/09/2026): `admin` and `estates_head` write the register, and
// this build gates the *page* the same way — a role that has no write
// reason to be here (`GET /contractors` itself is open to any signed-in
// user, per `contractors.controller.ts`'s own header comment) still gets
// `NoPermission`, per the build brief's explicit "others get NoPermission"
// rather than a read-only view of a register they cannot act on.
export default async function ContractorsPage() {
  const session = await getSession();
  const roles = session?.me.roles ?? [];

  if (!canManageContractors(roles)) {
    const t = await getTranslations("screens.s24");
    return <NoPermission askRole={t("noPermissionAskRole")} />;
  }

  return (
    <>
      <ContractorsScreen isAdmin={isAdmin(roles)} noPermission={<NoPermission />} />
      <HelpSection route="/admin/contractors" />
    </>
  );
}
