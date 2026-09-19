import { z } from "zod";
import { AppRole } from "./auth";

/**
 * The role catalogue (CAPEX-01 §10, ADR-0020).
 *
 * `AppRole` in ./auth.ts is the list of the eight roles. This file says the
 * one thing about each of them that both ends need and neither should
 * hardcode: whether the role carries its own org units or sees every unit
 * anyway.
 *
 *   "unit"  the role only means something against a list of units, so an
 *           assignment without one grants nothing at all.
 *   "all"   the role reaches every unit. `admin`, `executive_readonly` and
 *           `auditor_readonly` do it through the row policies themselves
 *           (`ecapital.sees_all_units()`); `finance` does it by carrying
 *           every unit id, because the Οικονομική Διεύθυνση works across the
 *           organisation (ADR-0014, owner decision 19/09/2026) and is not in
 *           that function.
 *
 * FLAG (ADR-0020): `finance` is "all" today because that is how the seed and
 * ADR-0014 have it. If the organisation ever wants a finance officer per
 * directorate, this is the one line that changes — plus a decision about what
 * happens to the accounts that already carry every unit.
 */
export const RoleScope = z.enum(["all", "unit"]);
export type RoleScope = z.infer<typeof RoleScope>;

export const ROLE_SCOPE: Record<AppRole, RoleScope> = {
  admin: "all",
  estates_head: "unit",
  project_engineer: "unit",
  technician: "unit",
  finance: "all",
  clinical_approver: "unit",
  executive_readonly: "all",
  auditor_readonly: "all",
};

/** What `GET /admin/roles` answers, so the UI never hardcodes the eight. */
export const RoleCatalogueEntry = z.object({
  role: AppRole,
  scope: RoleScope,
});
export type RoleCatalogueEntry = z.infer<typeof RoleCatalogueEntry>;

export const RoleCatalogue = z.array(RoleCatalogueEntry);
export type RoleCatalogue = z.infer<typeof RoleCatalogue>;

export function isAllUnitsRole(role: AppRole): boolean {
  return ROLE_SCOPE[role] === "all";
}

/**
 * RULE (ADR-0020): a set of roles needs an explicit unit list only when none
 * of its roles already reaches every unit.
 */
export function needsOrgUnits(roles: AppRole[]): boolean {
  return roles.some((role) => ROLE_SCOPE[role] === "unit") && !roles.some(isAllUnitsRole);
}

/**
 * RULE (CAPEX-01 §10): the auditor "cannot be edited by admin". Granting or
 * revoking it is the bootstrap CLI's job and nobody else's (ADR-0020).
 */
export const ADMIN_PROTECTED_ROLES: AppRole[] = ["auditor_readonly"];

export function isAdminProtectedRole(role: AppRole): boolean {
  return ADMIN_PROTECTED_ROLES.includes(role);
}
