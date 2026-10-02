// S24e «eFinance» — ADR-0029

import { getTranslations } from "next-intl/server";
import { getSession } from "@/auth/session";
import { isAdmin } from "@/auth/roles";
import { AdminTabs, NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { EFinanceAdminScreen } from "@/screens/s24e-efinance/EFinanceAdminScreen";

// Server Component. RULE (ADR-0029): both syncs are `@Roles("admin")` on the
// API, so the page is gated the same way — nobody else is shown buttons that
// could only ever come back 403.
export default async function AdminEFinancePage() {
  const session = await getSession();
  const roles = session?.me.roles ?? [];

  if (!isAdmin(roles)) {
    const t = await getTranslations("screens.s24users");
    return (
      <>
        <AdminTabs />
        <NoPermission askRole={t("noPermissionAskRole")} />
      </>
    );
  }

  return (
    <>
      <AdminTabs />
      <EFinanceAdminScreen />
      <HelpSection route="/admin/efinance" />
    </>
  );
}
