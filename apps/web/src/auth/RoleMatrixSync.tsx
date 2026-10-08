"use client";

// ADR-0033 — the browser's half of the role matrix store.
//
// The layout already read the matrix with the session on the server. This
// puts the same matrix into the browser's copy of `role-matrix-store` before
// anything below it renders, so a Client Component that calls a helper from
// `@/auth/roles` decides with the matrix the server decided with.
//
// | Prop     | Type       | Notes                                          |
// |----------|------------|------------------------------------------------|
// | matrix   | RoleMatrix | `getSession().matrix`, the stored matrix.       |
// | children | ReactNode  | The shell and the page.                         |
//
// Set during render, not in an effect: an effect runs after the children have
// rendered once with whatever the store held before, which is the flash of a
// control that should not be there. Setting a module value is idempotent, so
// rendering twice does no harm.
import type { ReactNode } from "react";
import type { RoleMatrix } from "@ecapital/shared";
import { setRoleMatrix } from "./role-matrix-store";

export function RoleMatrixSync({ matrix, children }: { matrix: RoleMatrix; children: ReactNode }) {
  setRoleMatrix(matrix);
  return <>{children}</>;
}
