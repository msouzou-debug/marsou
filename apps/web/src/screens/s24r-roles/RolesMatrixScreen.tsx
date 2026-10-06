"use client";

// S24r «Ρόλοι και δικαιώματα» — R01, R42
//
// RolesMatrixScreen — the client boundary the page renders. The matrix is
// static shared data, so there is no query and no state to resolve: the
// page has already decided who may open it.
import type { ReactNode } from "react";
import { RolesMatrix } from "./RolesMatrix";

export function RolesMatrixScreen({ noPermission }: { noPermission: ReactNode }) {
  return <RolesMatrix state="default" noPermission={noPermission} />;
}
