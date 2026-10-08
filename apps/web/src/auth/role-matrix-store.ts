// ADR-0033 — the role matrix the web helpers read.
//
// The matrix lives in the API's `ecapital.role_permission` and the
// administrator edits it on «Ρόλοι και δικαιώματα». The helpers in
// `./roles` keep their names and their `(roles)` signature, so no screen had
// to change; underneath, each one asks this store what the loaded matrix
// gives the caller's roles.
//
// Where it is set:
//   * on the server, by `getSession()` (`./session.ts`), which reads
//     `GET /admin/roles/permissions` next to `/me` on every request — so a
//     Server Component that gates with a helper after `getSession()` sees the
//     matrix as it stands now;
//   * in the browser, by `RoleMatrixSync` in the app shell, from the same
//     answer the layout already fetched, before any page below it renders.
//
// One matrix for everybody, not per user: what differs between callers is
// their roles, which the helpers take as an argument. So a module-level value
// is safe on the server too — two requests at once write the same thing.
//
// Until something sets it, it is `ROLE_MATRIX`, the shipped defaults: a test,
// a preview, a page rendered while the API was down.
import {
  ROLE_MATRIX,
  atLeast,
  levelFor,
  type AccessLevel,
  type AppRole,
  type MatrixArea,
  type RoleMatrix,
} from "@ecapital/shared";

let loaded: RoleMatrix = ROLE_MATRIX;

/** Put a matrix in place; null or undefined goes back to the defaults. */
export function setRoleMatrix(matrix: RoleMatrix | null | undefined): void {
  loaded = matrix ?? ROLE_MATRIX;
}

/** The matrix the helpers are reading right now. */
export function getRoleMatrix(): RoleMatrix {
  return loaded;
}

/**
 * RULE (ADR-0010, `ecapital.can_write_unit`): an account that also holds the
 * auditor or the executive role writes nothing, whatever its other roles. The
 * database refuses the save; this keeps the control off the screen.
 */
const READ_ONLY_ROLES: readonly AppRole[] = ["auditor_readonly", "executive_readonly"];

/**
 * True when any of `roles` holds at least `level` on `area` in the loaded
 * matrix. From WRITE up, a read-only role among them says no.
 */
export function levelAtLeast(roles: readonly AppRole[], area: MatrixArea, level: AccessLevel): boolean {
  if (atLeast(level, "WRITE") && roles.some((role) => READ_ONLY_ROLES.includes(role))) return false;
  return atLeast(levelFor(loaded, roles, area), level);
}
