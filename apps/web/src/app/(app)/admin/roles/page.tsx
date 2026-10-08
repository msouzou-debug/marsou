// S24r «Ρόλοι και δικαιώματα» — R01, R42 (ADR-0033)

import { getTranslations } from "next-intl/server";
import { RolePermissionsResponse } from "@ecapital/shared";
import { getSession } from "@/auth/session";
import { canViewRoleMatrix, isAdmin } from "@/auth/roles";
import { AdminTabs, NoPermission } from "@/components/app-shell";
import { apiFetch } from "@/data/client";
import { HelpSection } from "@/help/HelpSection";
import { RolesMatrixScreen } from "@/screens/s24r-roles/RolesMatrixScreen";

// Server Component. Owner ask (06/10/2026): the administrator, who hands
// out roles, and the head of estates, who is asked what a role gets. Others
// get NoPermission with who to ask, the same way «Ανάδοχοι» does.
//
// ADR-0033 (owner, 08/10/2026): the matrix is now stored and the
// administrator edits it here. The page reads `GET /admin/roles/permissions`
// for the last-change stamp; if that read fails it still shows the matrix
// the session loaded, read only, rather than an error page for a table.
export default async function RolesPage() {
  const session = await getSession();
  const roles = session?.me.roles ?? [];

  if (!session || !canViewRoleMatrix(roles)) {
    const t = await getTranslations("screens.s24roles");
    return (
      <>
        <AdminTabs />
        <NoPermission askRole={t("noPermissionAskRole")} />
      </>
    );
  }

  const stored = await apiFetch("/admin/roles/permissions", RolePermissionsResponse, { token: session.token }).catch(
    () => null,
  );

  return (
    <>
      <AdminTabs />
      <RolesMatrixScreen
        noPermission={<NoPermission />}
        matrix={stored?.matrix ?? session.matrix}
        updatedAt={stored?.updatedAt ?? null}
        // RULE (ADR-0033): identity, not a cell — the matrix cannot hand out
        // the right to change the matrix. The API's `@Roles("admin")` and the
        // row policy say the same.
        editable={isAdmin(roles) && stored !== null}
      />
      <HelpSection route="/admin/roles" />
    </>
  );
}
