"use client";

// S24 «Χρήστες» › «Χώροι και ρόλοι έγκρισης» — item 8, M3 (R22)
//
/**
 * ApproverScopesEditor — assigns the area roles (WARD_MANAGER, NURSING,
 * INFECTION_CONTROL) and the unit roles (TECHNICAL, SAFETY,
 * HOSPITAL_DIRECTOR, INFECTION_CONTROL, NURSING) a person may decide for
 * (task item 8, CAPEX-01 §6.4 — routing derives from these scopes).
 *
 * RULE (owner decision 26/11/2026): it has no save button of its own. It
 * reads the saved scopes (`GET /admin/users/:id/approver-scopes`) and hands
 * every change up to `UserSheet`, whose one «Αποθήκευση» sends them with the
 * roles in `PATCH /admin/users/:id`, so ticking a role and adding the scope
 * it allows is one save, checked by the API against the roles being saved.
 *
 * RULE (ADR-0039, owner decision 26/11/2026): it offers only the scopes the
 * ticked roles allow (`allowedApproverScopeRoles`, the same rule the API
 * refuses with 422): TECHNICAL and SAFETY for a technical and safety
 * approver, a clinical approver or an estates head; every other scope for a
 * clinical approver alone. A scope already saved is listed, and removable,
 * whatever the roles are now; one the roles no longer allow stays saved but
 * brings no approval lines, and the editor says so.
 *
 * | Prop     | Type                             | Notes                                                         |
 * |----------|----------------------------------|---------------------------------------------------------------|
 * | userId   | string                           | An existing account only — nothing to scope before it is one. |
 * | orgUnits | OrgUnit[]                        |                                                               |
 * | roles    | AppRole[]                        | The roles ticked on the sheet, which decide what is offered.  |
 * | value    | ApproverScopes or null           | The sheet's unsaved scopes; null while nothing was changed.   |
 * | onChange | (scopes: ApproverScopes) => void | Every add and remove, as the whole new picture.               |
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import {
  type AppRole,
  type ApproverScopes,
  type AreaApprovalRole,
  type OrgUnit,
  type UnitApprovalRole,
  allowedApproverScopeRoles,
} from "@ecapital/shared";
import { useApproverScopes, useAreaTree } from "@/data/queries";

export interface ApproverScopesEditorProps {
  userId: string;
  orgUnits: OrgUnit[];
  roles: AppRole[];
  value: ApproverScopes | null;
  onChange: (scopes: ApproverScopes) => void;
}

export function ApproverScopesEditor({ userId, orgUnits, roles, value, onChange }: ApproverScopesEditorProps) {
  const t = useTranslations("screens.s24users.approverScopes");
  const tRoot = useTranslations();
  const scopesQuery = useApproverScopes(userId);
  const allowed = allowedApproverScopeRoles(roles);
  const [pendingUnitId, setPendingUnitId] = useState(orgUnits[0]?.id ?? "");
  const areaTree = useAreaTree(pendingUnitId);
  const [areaAreaId, setAreaAreaId] = useState("");
  const [pickedAreaRole, setAreaRole] = useState<AreaApprovalRole | undefined>(undefined);
  const [unitId, setUnitId] = useState(orgUnits[0]?.id ?? "");
  const [pickedUnitRole, setUnitRole] = useState<UnitApprovalRole | undefined>(undefined);
  const current: ApproverScopes = value ?? scopesQuery.data ?? { areas: [], units: [] };
  const setScopes = onChange;
  // A choice the roles no longer allow (a role was unticked) falls back to
  // the first one they do.
  const areaRole = pickedAreaRole && allowed.areas.includes(pickedAreaRole) ? pickedAreaRole : allowed.areas[0];
  const unitRole = pickedUnitRole && allowed.units.includes(pickedUnitRole) ? pickedUnitRole : allowed.units[0];

  const areaOptions = (areaTree.data?.buildings ?? []).flatMap((b) => b.floors.flatMap((f) => f.areas.map((a) => ({ id: a.id, label: `${b.nameEl} · ${f.nameEl} · ${a.nameEl}` }))));

  function addAreaScope() {
    if (!areaAreaId || !areaRole) return;
    if (current.areas.some((a) => a.areaId === areaAreaId && a.role === areaRole)) return;
    setScopes({ ...current, areas: [...current.areas, { areaId: areaAreaId, role: areaRole }] });
  }
  function removeAreaScope(areaId: string, role: AreaApprovalRole) {
    setScopes({ ...current, areas: current.areas.filter((a) => !(a.areaId === areaId && a.role === role)) });
  }
  function addUnitScope() {
    if (!unitId || !unitRole) return;
    if (current.units.some((u) => u.orgUnitId === unitId && u.role === unitRole)) return;
    setScopes({ ...current, units: [...current.units, { orgUnitId: unitId, role: unitRole }] });
  }
  function removeUnitScope(orgUnitId: string, role: UnitApprovalRole) {
    setScopes({ ...current, units: current.units.filter((u) => !(u.orgUnitId === orgUnitId && u.role === role)) });
  }

  const unitNameById = new Map(orgUnits.map((u) => [u.id, u.nameEl] as const));
  const nothingAllowed = allowed.areas.length === 0 && allowed.units.length === 0;
  // A saved scope the ticked roles no longer allow: kept, and inert.
  const inert =
    current.areas.some((a) => !allowed.areas.includes(a.role)) ||
    current.units.some((u) => !allowed.units.includes(u.role));

  return (
    <div className="mt-s-4 rounded-k border border-k-grey p-s-4">
      <h3 className="text-fs-16 font-bold text-k-ink">{t("title")}</h3>

      {nothingAllowed && <p className="mt-s-2 text-fs-14 text-k-text">{t("noScopes")}</p>}
      {inert && <p className="mt-s-2 text-fs-14 text-k-text">{t("keptHint")}</p>}

      {(allowed.areas.length > 0 || current.areas.length > 0) && (
        <div className="mt-s-3">
          <p className="text-fs-14 font-bold text-k-text">{t("areasLabel")}</p>
          <ul className="mt-s-2 grid gap-s-1">
            {current.areas.map((a) => (
              <li key={`${a.areaId}-${a.role}`} className="flex items-center justify-between gap-s-2 text-fs-14 text-k-ink">
                <span>{areaOptions.find((o) => o.id === a.areaId)?.label ?? a.areaId} — {tRoot(`areaApprovalRole.${a.role}`)}</span>
                <button type="button" onClick={() => removeAreaScope(a.areaId, a.role)} aria-label={tRoot("common.close")} className="text-k-text">
                  <X size={20} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {allowed.areas.length > 0 && (
            <div className="mt-s-2 flex flex-wrap items-end gap-s-2">
              <select value={pendingUnitId} onChange={(e) => { setPendingUnitId(e.target.value); setAreaAreaId(""); }} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
                {orgUnits.map((u) => <option key={u.id} value={u.id}>{u.nameEl}</option>)}
              </select>
              <select value={areaAreaId} onChange={(e) => setAreaAreaId(e.target.value)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
                <option value="">{t("pickArea")}</option>
                {areaOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <select value={areaRole} onChange={(e) => setAreaRole(e.target.value as AreaApprovalRole)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
                {allowed.areas.map((r) => <option key={r} value={r}>{tRoot(`areaApprovalRole.${r}`)}</option>)}
              </select>
              <button type="button" onClick={addAreaScope} className="h-11 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">{tRoot("buttons.add")}</button>
            </div>
          )}
        </div>
      )}

      {(allowed.units.length > 0 || current.units.length > 0) && (
        <div className="mt-s-5">
          <p className="text-fs-14 font-bold text-k-text">{t("unitsLabel")}</p>
          <ul className="mt-s-2 grid gap-s-1">
            {current.units.map((u) => (
              <li key={`${u.orgUnitId}-${u.role}`} className="flex items-center justify-between gap-s-2 text-fs-14 text-k-ink">
                <span>{unitNameById.get(u.orgUnitId) ?? u.orgUnitId} — {tRoot(`unitApprovalRole.${u.role}`)}</span>
                <button type="button" onClick={() => removeUnitScope(u.orgUnitId, u.role)} aria-label={tRoot("common.close")} className="text-k-text">
                  <X size={20} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {allowed.units.length > 0 && (
            <div className="mt-s-2 flex flex-wrap items-end gap-s-2">
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
                {orgUnits.map((u) => <option key={u.id} value={u.id}>{u.nameEl}</option>)}
              </select>
              <select value={unitRole} onChange={(e) => setUnitRole(e.target.value as UnitApprovalRole)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
                {allowed.units.map((r) => <option key={r} value={r}>{tRoot(`unitApprovalRole.${r}`)}</option>)}
              </select>
              <button type="button" onClick={addUnitScope} className="h-11 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">{tRoot("buttons.add")}</button>
            </div>
          )}
        </div>
      )}

      <p className="mt-s-4 text-fs-14 text-k-text">{t("saveHint")}</p>
    </div>
  );
}
