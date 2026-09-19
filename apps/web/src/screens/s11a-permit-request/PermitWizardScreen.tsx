"use client";

// S11a — R19
//
/**
 * PermitWizardScreen — S11's shutdown request wizard, `/permits/new` and
 * `/permits/[id]/edit` (UI instructions §5 item 2). One file, not the usual
 * Screen/pure split: every step depends on a different combination of
 * queries (the unit's area tree, its system feeds, the live area-impact
 * call, its projects and contracts), and splitting that into a "pure"
 * component would only move the same hook calls one level down —
 * `PermitDetail`'s split still holds for the record page below this one.
 *
 * | Prop     | Type                          | Notes                                                            |
 * |----------|-------------------------------|----------------------------------------------------------------------|
 * | mode     | "create" \| "edit"             |                                                                       |
 * | permitId | string?                       | Required in "edit".                                                   |
 * | orgUnits | OrgUnit[]                     | The caller's own visible units (R01).                                 |
 * | noPermission | ReactNode                 |                                                                       |
 *
 * RULE (task item 2): autosave — the draft is created (`POST /permits`) the
 * moment the requester leaves step 1, and every further step change PATCHes
 * it, so a refresh loses nothing. ASSUMPTION (flagged in the hand-back
 * summary): the contract's `ShutdownPermitDraft` requires `affectedAreaIds`
 * (min 1) and both planned dates, none of which step 1 collects — the POST
 * at that point sends only what step 1 knows (systems, work kind, title,
 * description, project/contract) and the API is assumed to accept that as a
 * genuine partial create, the same way `PATCH` already takes a partial body.
 *
 * RULE (§6.2, `canRemoveArea`, `src/lib/permit-rules.ts`): an area `/areas/impact`
 * returns as INDIRECT can never be unpicked from step 2 — only a DIRECT one
 * (an id in `draft.areaIds`) is removable, and `AreaPicker` itself renders no
 * control for the indirect ones at all.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AppRole, IlsmTrigger, OrgUnit, PermitSystem, ShutdownPermit, ShutdownPermitDraft } from "@ecapital/shared";
import { IlsmTrigger as IlsmTriggerEnum, PermitSystem as PermitSystemEnum, ShutdownPermit as ShutdownPermitSchema } from "@ecapital/shared";
import type { ReactNode } from "react";
import { canWritePermits } from "@/auth/roles";
import { AreaPicker } from "@/components/area-picker";
import { WizardShell } from "@/components/wizard-shell";
import { ApiError, apiMutate } from "@/data/client";
import { useAreaImpact, usePermit, useProjectsForUnit, useContracts, useAreaTree } from "@/data/queries";
import { formatDateTime } from "@/lib/format";
import { durationMinutes, EMPTY_WIZARD_DRAFT, step1Complete, step2Complete, step3Complete, type PermitWizardDraft } from "./schema";

export interface PermitWizardScreenProps {
  mode: "create" | "edit";
  permitId?: string;
  roles: AppRole[];
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  noPermission: ReactNode;
}

const STEP_IDS = ["system", "areas", "dates", "overview"] as const;
type StepId = (typeof STEP_IDS)[number];

export function draftToBody(draft: PermitWizardDraft): Partial<ShutdownPermitDraft> {
  return {
    titleEl: draft.titleEl,
    descriptionEl: draft.descriptionEl,
    workKind: draft.workKind,
    systems: draft.systems,
    affectedAreaIds: draft.areaIds,
    projectId: draft.projectId,
    contractId: draft.contractId,
    plannedStart: draft.plannedStart ? new Date(draft.plannedStart).toISOString() : undefined,
    plannedEnd: draft.plannedEnd ? new Date(draft.plannedEnd).toISOString() : undefined,
    ilsmTriggers: draft.ilsmTriggers,
    contingencyPlanEl: draft.contingencyPlanEl || null,
  };
}

export function PermitWizardScreen({ mode, permitId, roles, orgUnits, defaultOrgUnitId, noPermission }: PermitWizardScreenProps) {
  const t = useTranslations();
  const router = useRouter();

  const existing = usePermit(mode === "edit" ? (permitId ?? "") : "");
  const [id, setId] = useState<string | null>(mode === "edit" ? (permitId ?? null) : null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<PermitWizardDraft>({
    ...EMPTY_WIZARD_DRAFT,
    orgUnitId: defaultOrgUnitId ?? orgUnits[0]?.id ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);
  const [hydratedFromId, setHydratedFromId] = useState<string | null>(null);

  // RULE: editing loads the existing permit once and seeds the draft from it
  // — only ever for a DRAFT permit, or one an approver has returned to the
  // requester (ASSUMPTION: the contract has no distinct RETURNED *status*,
  // only a RETURNED *approval decision* — see `packages/shared/src/permit.ts`
  // — so "returned" here means any approval line carries that decision).
  //
  // Adjusted during render, not in an effect (react.dev/learn/you-might-not-need-an-effect
  // — the same pattern S02's `Projects.tsx` uses for `searchDraft`/`syncedQ`):
  // this only ever needs to run once per loaded permit, which "have I already
  // hydrated from this id" answers without a `useEffect` at all.
  if (mode === "edit" && existing.data && hydratedFromId !== existing.data.id) {
    const p = existing.data;
    setHydratedFromId(p.id);
    setDraft({
      orgUnitId: p.orgUnitId,
      systems: p.systems,
      workKind: p.workKind,
      titleEl: p.titleEl,
      descriptionEl: p.descriptionEl,
      projectId: p.projectId,
      contractId: p.contractId,
      areaIds: p.affectedAreas.filter((a) => a.impact === "DIRECT").map((a) => a.areaId),
      plannedStart: p.plannedStart ? p.plannedStart.slice(0, 16) : "",
      plannedEnd: p.plannedEnd ? p.plannedEnd.slice(0, 16) : "",
      ilsmTriggers: [],
      contingencyPlanEl: p.contingencyPlanEl ?? "",
    });
  }

  const areaTree = useAreaTree(draft.orgUnitId);
  const areaImpact = useAreaImpact(draft.orgUnitId, draft.systems, draft.areaIds);
  const projectsForUnit = useProjectsForUnit(draft.orgUnitId);
  const contracts = useContracts();

  const canContinueByStep: Record<StepId, boolean> = {
    system: step1Complete(draft),
    areas: step2Complete(draft),
    dates: step3Complete(draft),
    overview: true,
  };

  async function persist(currentDraft: PermitWizardDraft): Promise<void> {
    setSaving(true);
    setApiError(undefined);
    try {
      if (!id) {
        // RULE: created the first time the requester leaves step 1.
        const created = await apiMutate<ShutdownPermit>("/permits", "POST", draftToBody(currentDraft), ShutdownPermitSchema);
        setId(created.id);
      } else {
        await apiMutate<ShutdownPermit>(`/permits/${encodeURIComponent(id)}`, "PATCH", draftToBody(currentDraft), ShutdownPermitSchema);
      }
    } catch (persistError) {
      setApiError(persistError instanceof ApiError ? persistError.message : String(persistError));
    } finally {
      setSaving(false);
    }
  }

  function handleStepChange(nextIndex: number) {
    void persist(draft);
    // Clamp: WizardShell's own `handleNext` computes `current + 1` even on
    // the last step (where "Continue" becomes "Συνέχεια στην ICRA" and does
    // not advance a step at all) — see this file's `onNext` below, which is
    // what actually decides whether that click submits.
    setStep(Math.max(0, Math.min(STEP_IDS.length - 1, nextIndex)));
  }

  async function handleSubmitOverview(): Promise<void> {
    await persist(draft);
    if (id) router.push(`/permits/${encodeURIComponent(id)}/icra`);
  }

  const orgUnit = orgUnits.find((u) => u.id === draft.orgUnitId);
  const unitLabel = orgUnit?.nameEl ?? draft.orgUnitId;
  const minutes = durationMinutes(draft);
  const ilsmRequired = draft.ilsmTriggers.length > 0;

  if ((mode === "edit" && existing.error) || !canWritePermits(roles)) {
    return <>{noPermission}</>;
  }

  const steps = STEP_IDS.map((s) => ({ id: s, label: t(`screens.s11a.steps.${s}`) }));

  return (
    <>
      <h1 className="mb-s-5 text-fs-24 text-k-blue-deep">{t(mode === "create" ? "screens.s11a.titleNew" : "screens.s11a.titleEdit")}</h1>
      <WizardShell
        steps={steps}
        current={step}
        onBack={() => undefined}
        onNext={() => {
          if (step === STEP_IDS.length - 1) void handleSubmitOverview();
        }}
        canContinue={canContinueByStep[STEP_IDS[step]]}
        onStepChange={handleStepChange}
        submitLabel={t("screens.s11a.continueToIcra")}
      >
        {STEP_IDS[step] === "system" && (
          <div className="grid gap-s-5">
            {orgUnits.length > 1 && (
              <div className="flex flex-col gap-s-1">
                <label htmlFor="pw-unit" className="text-fs-14 text-k-text">{t("common.unit")}</label>
                <select
                  id="pw-unit"
                  value={draft.orgUnitId}
                  onChange={(e) => setDraft({ ...draft, orgUnitId: e.target.value, areaIds: [] })}
                  className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
                >
                  {orgUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.nameEl}</option>
                  ))}
                </select>
              </div>
            )}

            <fieldset>
              <legend className="mb-s-2 text-fs-14 text-k-text">{t("screens.s11a.fields.systems")}</legend>
              <div className="grid grid-cols-2 gap-s-2">
                {PermitSystemEnum.options.map((sys: PermitSystem) => (
                  <label key={sys} className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
                    <input
                      type="checkbox"
                      checked={draft.systems.includes(sys)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          systems: e.target.checked ? [...draft.systems, sys] : draft.systems.filter((s) => s !== sys),
                        })
                      }
                    />
                    {t(`permitSystem.${sys}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-s-1">
              <label htmlFor="pw-workkind" className="text-fs-14 text-k-text">{t("screens.s11a.fields.workKind")}</label>
              <select
                id="pw-workkind"
                value={draft.workKind}
                onChange={(e) => setDraft({ ...draft, workKind: e.target.value as PermitWizardDraft["workKind"] })}
                className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
              >
                {(["CONSTRUCTION", "RENOVATION", "MAINTENANCE", "INSPECTION", "OTHER"] as const).map((k) => (
                  <option key={k} value={k}>{t(`workKind.${k}`)}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-s-1">
              <label htmlFor="pw-title" className="text-fs-14 text-k-text">{t("screens.s11a.fields.title")}</label>
              <input
                id="pw-title"
                type="text"
                value={draft.titleEl}
                onChange={(e) => setDraft({ ...draft, titleEl: e.target.value })}
                className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
              />
            </div>

            <div className="flex flex-col gap-s-1">
              <label htmlFor="pw-description" className="text-fs-14 text-k-text">{t("screens.s11a.fields.description")}</label>
              <textarea
                id="pw-description"
                value={draft.descriptionEl}
                onChange={(e) => setDraft({ ...draft, descriptionEl: e.target.value })}
                rows={3}
                className="rounded-k border border-k-grey p-s-3 text-fs-16"
              />
            </div>

            <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
              <div className="flex flex-col gap-s-1">
                <label htmlFor="pw-project" className="text-fs-14 text-k-text">{t("screens.s11a.fields.project")}</label>
                <select
                  id="pw-project"
                  value={draft.projectId ?? ""}
                  onChange={(e) => setDraft({ ...draft, projectId: e.target.value || null })}
                  className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
                >
                  <option value="">{t("screens.s11a.fields.none")}</option>
                  {(projectsForUnit.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.titleEl}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-s-1">
                <label htmlFor="pw-contract" className="text-fs-14 text-k-text">{t("screens.s11a.fields.contract")}</label>
                <select
                  id="pw-contract"
                  value={draft.contractId ?? ""}
                  onChange={(e) => setDraft({ ...draft, contractId: e.target.value || null })}
                  className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
                >
                  <option value="">{t("screens.s11a.fields.none")}</option>
                  {(contracts.data?.items ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.contractNo}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {STEP_IDS[step] === "areas" && (
          <div>
            <p className="mb-s-3 text-fs-16 text-k-ink">{t("screens.s11a.steps.areasHint", { unit: unitLabel })}</p>
            <AreaPicker
              areaTree={areaTree.data ?? { orgUnitId: draft.orgUnitId, buildings: [] }}
              selectedAreaIds={draft.areaIds}
              onToggle={(areaId) =>
                setDraft({
                  ...draft,
                  areaIds: draft.areaIds.includes(areaId) ? draft.areaIds.filter((a) => a !== areaId) : [...draft.areaIds, areaId],
                })
              }
              indirectAreas={(areaImpact.data ?? []).filter((a) => a.impact === "INDIRECT")}
              loadingIndirect={areaImpact.isLoading}
            />
          </div>
        )}

        {STEP_IDS[step] === "dates" && (
          <div className="grid gap-s-5">
            <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
              <div className="flex flex-col gap-s-1">
                <label htmlFor="pw-start" className="text-fs-14 text-k-text">{t("screens.s11a.fields.plannedStart")}</label>
                <input
                  id="pw-start"
                  type="datetime-local"
                  value={draft.plannedStart}
                  onChange={(e) => setDraft({ ...draft, plannedStart: e.target.value })}
                  className="num h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
                />
              </div>
              <div className="flex flex-col gap-s-1">
                <label htmlFor="pw-end" className="text-fs-14 text-k-text">{t("screens.s11a.fields.plannedEnd")}</label>
                <input
                  id="pw-end"
                  type="datetime-local"
                  value={draft.plannedEnd}
                  onChange={(e) => setDraft({ ...draft, plannedEnd: e.target.value })}
                  className="num h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
                />
              </div>
            </div>
            {minutes !== null && (
              <p className="num text-fs-14 text-k-text">{t("screens.s11a.duration", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })}</p>
            )}

            <fieldset>
              <legend className="mb-s-2 text-fs-14 text-k-text">{t("screens.s11a.fields.ilsmTriggers")}</legend>
              <div className="grid gap-s-2">
                {IlsmTriggerEnum.options.map((trigger: IlsmTrigger) => (
                  <label key={trigger} className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
                    <input
                      type="checkbox"
                      checked={draft.ilsmTriggers.includes(trigger)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          ilsmTriggers: e.target.checked
                            ? [...draft.ilsmTriggers, trigger]
                            : draft.ilsmTriggers.filter((x) => x !== trigger),
                        })
                      }
                    />
                    {t(`ilsmTrigger.${trigger}`)}
                  </label>
                ))}
              </div>
              {/* RULE (§6.3, CAPEX-01): ILSM becomes mandatory the moment any trigger is picked. */}
              {ilsmRequired && <p className="mt-s-2 text-fs-14 text-k-amber">{t("screens.s11a.ilsmMandatory")}</p>}
            </fieldset>

            <div className="flex flex-col gap-s-1">
              <label htmlFor="pw-contingency" className="text-fs-14 text-k-text">{t("screens.s11a.fields.contingencyPlan")}</label>
              <textarea
                id="pw-contingency"
                value={draft.contingencyPlanEl}
                onChange={(e) => setDraft({ ...draft, contingencyPlanEl: e.target.value })}
                rows={3}
                className="rounded-k border border-k-grey p-s-3 text-fs-16"
              />
            </div>
          </div>
        )}

        {STEP_IDS[step] === "overview" && (
          <div className="grid gap-s-3 text-fs-14">
            <p><span className="text-k-text-muted">{t("common.unit")}:</span> {unitLabel}</p>
            <p><span className="text-k-text-muted">{t("screens.s11a.fields.title")}:</span> {draft.titleEl}</p>
            <p><span className="text-k-text-muted">{t("screens.s11.columns.systems")}:</span> {draft.systems.map((s) => t(`permitSystem.${s}`)).join(", ")}</p>
            <p><span className="text-k-text-muted">{t("screens.s11a.fields.workKind")}:</span> {t(`workKind.${draft.workKind}`)}</p>
            <p><span className="text-k-text-muted">{t("screens.s11.columns.window")}:</span> {draft.plannedStart && formatDateTime(draft.plannedStart)} – {draft.plannedEnd && formatDateTime(draft.plannedEnd)}</p>
            <p><span className="text-k-text-muted">{t("screens.s11a.fields.ilsmTriggers")}:</span> {ilsmRequired ? t("common.yes") : t("common.no")}</p>
            {apiError && <p role="alert" className="text-fs-14 text-k-red">{apiError}</p>}
          </div>
        )}
      </WizardShell>
      {saving && <p className="mt-s-3 text-fs-12 text-k-text-muted">{t("screens.s11a.saving")}</p>}
    </>
  );
}
