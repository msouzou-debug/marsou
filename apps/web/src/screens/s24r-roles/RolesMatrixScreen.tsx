"use client";

// S24r «Ρόλοι και δικαιώματα» — R01, R42 (ADR-0033)
//
// RolesMatrixScreen — the client boundary the page renders. The page has
// already decided who may open it and loaded the stored matrix with the
// session; this wires the administrator's two writes to the API through the
// same-origin proxy (ADR-0013) and, once one answers, puts the new matrix in
// the browser's store and refreshes the server components, so every helper
// on the next screen already decides by it.
//
// | Prop         | Type           | Notes                                              |
// |--------------|----------------|----------------------------------------------------|
// | noPermission | ReactNode      | Passed through to `RolesMatrix`.                   |
// | matrix       | RoleMatrix     | `GET /admin/roles/permissions`, read by the page.  |
// | updatedAt    | string \| null | The last change.                                   |
// | editable     | boolean        | The administrator (identity, not a cell).          |
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RolePermissionsResponse, type AppRole, type RoleColumn, type RoleMatrix } from "@ecapital/shared";
import { setRoleMatrix } from "@/auth/role-matrix-store";
import { apiMutate } from "@/data/client";
import { RolesMatrix } from "./RolesMatrix";

export interface RolesMatrixScreenProps {
  noPermission: ReactNode;
  matrix: RoleMatrix;
  updatedAt: string | null;
  editable: boolean;
}

export function RolesMatrixScreen({ noPermission, matrix, updatedAt, editable }: RolesMatrixScreenProps) {
  const router = useRouter();

  function applied(response: RolePermissionsResponse): RoleMatrix {
    setRoleMatrix(response.matrix);
    router.refresh();
    return response.matrix;
  }

  async function save(role: AppRole, column: RoleColumn): Promise<RoleMatrix> {
    return applied(await apiMutate(`/admin/roles/${role}`, "PUT", column, RolePermissionsResponse));
  }

  async function reset(): Promise<RoleMatrix> {
    return applied(await apiMutate("/admin/roles/reset", "POST", undefined, RolePermissionsResponse));
  }

  return (
    <RolesMatrix
      state="default"
      noPermission={noPermission}
      matrix={matrix}
      updatedAt={updatedAt}
      editable={editable}
      onSave={editable ? save : undefined}
      onReset={editable ? reset : undefined}
    />
  );
}
