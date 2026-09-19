// S24 «Χρήστες» — R01, R02, R42 (ADR-0020)

import { getTranslations } from "next-intl/server";
import { getSession } from "@/auth/session";
import { isAdmin } from "@/auth/roles";
import { AdminTabs, NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { UsersScreen } from "@/screens/s24-users/UsersScreen";

// Server Component. RULE (ADR-0020, owner decision 19/09/2026): roles are
// assigned to a person by an administrator inside eCapital, and only by an
// administrator — `@Roles("admin")` on every `/admin/users` route and the row
// policies on `app_user`, `app_user_role` and `app_user_org_unit` underneath
// them. The page is gated the same way, so nobody else is shown a table they
// would only ever get 403 from.
export default async function AdminUsersPage() {
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

  // Everything the caller may see, which for an administrator is all twelve —
  // the unit filter and the sheet's multi-select both read this list rather
  // than one of their own (R01, ADR-0010).
  const orgUnits = await getVisibleOrgUnits();

  return (
    <>
      <AdminTabs />
      <UsersScreen orgUnits={orgUnits} noPermission={<NoPermission />} />
      <HelpSection route="/admin/users" />
    </>
  );
}
