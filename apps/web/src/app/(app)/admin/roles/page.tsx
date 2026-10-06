// S24r «Ρόλοι και δικαιώματα» — R01, R42

import { getTranslations } from "next-intl/server";
import { getSession } from "@/auth/session";
import { canViewRoleMatrix } from "@/auth/roles";
import { AdminTabs, NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { RolesMatrixScreen } from "@/screens/s24r-roles/RolesMatrixScreen";

// Server Component. Owner ask (06/10/2026): the administrator, who hands
// out roles, and the head of estates, who is asked what a role gets. Others
// get NoPermission with who to ask, the same way «Ανάδοχοι» does. The page
// reads no API route: the matrix is static data in `@ecapital/shared`.
export default async function RolesPage() {
  const session = await getSession();
  const roles = session?.me.roles ?? [];

  if (!canViewRoleMatrix(roles)) {
    const t = await getTranslations("screens.s24roles");
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
      <RolesMatrixScreen noPermission={<NoPermission />} />
      <HelpSection route="/admin/roles" />
    </>
  );
}
