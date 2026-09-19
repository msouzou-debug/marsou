"use client";

// S24 «Χρήστες» › «Χώροι και ρόλοι έγκρισης» — item 8, M3 (R22)
//
/**
 * ApproverScopesEditor — for a `clinical_approver`, assigns the area roles
 * (WARD_MANAGER, NURSING, INFECTION_CONTROL) and the unit roles (TECHNICAL,
 * SAFETY, HOSPITAL_DIRECTOR, INFECTION_CONTROL, NURSING) that person may
 * decide for (task item 8, CAPEX-01 §6.4 — routing derives from these
 * scopes). Self-contained: it loads and saves
 * `GET/PUT /admin/users/:id/approver-scopes` on its own, independent of the
 * rest of `UserSheet`'s own Save.
 *
 * | Prop     | Type      | Notes                                                  |
 * |----------|-----------|------------------------------------------------------------|
 * | userId   | string    | An existing account only — nothing to scope before it is one. |
 * | orgUnits | OrgUnit[] |                                                             |
 *
 * ASSUMPTION (flagged in the hand-back summary and in
 * `packages/shared/src/permit.ts`'s own note on `ApproverScopes`): the
 * endpoint is not in CAPEX-01's own list; the PM reconciles the name at
 * merge if the API agent chose a different one.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import {
  ApproverScopes,
  type AreaApprovalRole,
  type OrgUnit,
  type UnitApprovalRole,
} from "@ecapital/shared";
import { AreaApprovalRole as AreaApprovalRoleEnum, UnitApprovalRole as UnitApprovalRoleEnum } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useApproverScopes, useAreaTree } from "@/data/queries";

export interface ApproverScopesEditorProps {
  userId: string;
  orgUnits: OrgUnit[];
}

export function ApproverScopesEditor({ userId, orgUnits }: ApproverScopesEditorProps) {
  const t = useTranslations("screens.s24users.approverScopes");
  const tRoot = useTranslations();
  const scopesQuery = useApproverScopes(userId);
  const [pendingUnitId, setPendingUnitId] = useState(orgUnits[0]?.id ?? "");
  const areaTree = useAreaTree(pendingUnitId);
  const [areaAreaId, setAreaAreaId] = useState("");
  const [areaRole, setAreaRole] = useState<AreaApprovalRole>("WARD_MANAGER");
  const [unitId, setUnitId] = useState(orgUnits[0]?.id ?? "");
  const [unitRole, setUnitRole] = useState<UnitApprovalRole>("TECHNICAL");
  const [scopes, setScopes] = useState<{ areas: { areaId: string; role: AreaApprovalRole }[]; units: { orgUnitId: string; role: UnitApprovalRole }[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  const current = scopes ?? scopesQuery.data ?? { areas: [], units: [] };

  const areaOptions = (areaTree.data?.buildings ?? []).flatMap((b) => b.floors.flatMap((f) => f.areas.map((a) => ({ id: a.id, label: `${b.nameEl} · ${f.nameEl} · ${a.nameEl}` }))));

  function addAreaScope() {
    if (!areaAreaId) return;
    setScopes({ ...current, areas: [...current.areas, { areaId: areaAreaId, role: areaRole }] });
  }
  function removeAreaScope(areaId: string, role: AreaApprovalRole) {
    setScopes({ ...current, areas: current.areas.filter((a) => !(a.areaId === areaId && a.role === role)) });
  }
  function addUnitScope() {
    if (!unitId) return;
    setScopes({ ...current, units: [...current.units, { orgUnitId: unitId, role: unitRole }] });
  }
  function removeUnitScope(orgUnitId: string, role: UnitApprovalRole) {
    setScopes({ ...current, units: current.units.filter((u) => !(u.orgUnitId === orgUnitId && u.role === role)) });
  }

  async function save(): Promise<void> {
    setSaving(true);
    setApiError(undefined);
    try {
      await apiMutate(`/admin/users/${encodeURIComponent(userId)}/approver-scopes`, "PUT", current, ApproverScopes);
      await scopesQuery.refetch();
      setScopes(null);
    } catch (error) {
      setApiError(error instanceof ApiError ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const unitNameById = new Map(orgUnits.map((u) => [u.id, u.nameEl] as const));

  return (
    <div className="mt-s-4 rounded-k border border-k-grey p-s-4">
      <h3 className="text-fs-16 font-bold text-k-ink">{t("title")}</h3>

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
        <div className="mt-s-2 flex flex-wrap items-end gap-s-2">
          <select value={pendingUnitId} onChange={(e) => { setPendingUnitId(e.target.value); setAreaAreaId(""); }} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
            {orgUnits.map((u) => <option key={u.id} value={u.id}>{u.nameEl}</option>)}
          </select>
          <select value={areaAreaId} onChange={(e) => setAreaAreaId(e.target.value)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
            <option value="">{t("pickArea")}</option>
            {areaOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select value={areaRole} onChange={(e) => setAreaRole(e.target.value as AreaApprovalRole)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
            {AreaApprovalRoleEnum.options.map((r) => <option key={r} value={r}>{tRoot(`areaApprovalRole.${r}`)}</option>)}
          </select>
          <button type="button" onClick={addAreaScope} className="h-11 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">{tRoot("buttons.add")}</button>
        </div>
      </div>

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
        <div className="mt-s-2 flex flex-wrap items-end gap-s-2">
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
            {orgUnits.map((u) => <option key={u.id} value={u.id}>{u.nameEl}</option>)}
          </select>
          <select value={unitRole} onChange={(e) => setUnitRole(e.target.value as UnitApprovalRole)} className="h-11 rounded-k border border-k-grey px-s-2 text-fs-14">
            {UnitApprovalRoleEnum.options.map((r) => <option key={r} value={r}>{tRoot(`unitApprovalRole.${r}`)}</option>)}
          </select>
          <button type="button" onClick={addUnitScope} className="h-11 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">{tRoot("buttons.add")}</button>
        </div>
      </div>

      {apiError && <p role="alert" className="mt-s-3 text-fs-14 text-k-red">{apiError}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="mt-s-4 rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
      >
        {tRoot("buttons.save")}
      </button>
    </div>
  );
}
