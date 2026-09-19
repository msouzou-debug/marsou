"use client";

// S12 — R20, R21
//
/**
 * IcraWizardScreen — the four-step ICRA wizard, `/permits/[id]/icra` (UI
 * instructions §5 item 3). One file, same reason `PermitWizardScreen` is:
 * step 3 calls `/icra/evaluate` live off step 1/2's own state, which a
 * Screen/pure split would only relay through extra props.
 *
 * | Prop         | Type      | Notes                                    |
 * |--------------|-----------|-----------------------------------------------|
 * | permitId     | string    | The `[id]` route segment.                       |
 * | noPermission | ReactNode |                                                 |
 *
 * RULE (§6.2): Class III+ requires a permit; Class II is refused outright
 * for CONSTRUCTION/RENOVATION (`IcraResult.refusalKey`) — Υποβολή stays
 * disabled and the refusal sentence shows instead of the controls list.
 *
 * RULE (UI instructions §5 S12): every control must be «Ενημερώθηκα»-ticked
 * before Υποβολή enables — `allControlsAcknowledged`, `src/lib/permit-rules.ts`.
 *
 * RULE (item 3): the clash warnings the submit response carries render as an
 * amber strip and never block — the permit is SUBMITTED regardless.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { IcraActivityType, IcraResult, ShutdownPermit, SurroundingSide } from "@ecapital/shared";
import { IcraResult as IcraResultSchema, ShutdownPermit as ShutdownPermitSchema, SurroundingSide as SurroundingSideEnum } from "@ecapital/shared";
import { ControlsChecklist } from "@/components/controls-checklist";
import { IcraBadge } from "@/components/icra-badge";
import { IcraMatrixGrid } from "@/components/icra-matrix-grid";
import { WizardShell } from "@/components/wizard-shell";
import { ApiError, apiMutate } from "@/data/client";
import { useIcraMatrix, usePermit } from "@/data/queries";
import { allControlsAcknowledged } from "@/lib/permit-rules";

export interface IcraWizardScreenProps {
  permitId: string;
  noPermission: ReactNode;
}

const ACTIVITY_TYPES: IcraActivityType[] = ["A", "B", "C", "D"];
const STEP_IDS = ["activity", "surrounding", "class", "submit"] as const;

export function IcraWizardScreen({ permitId, noPermission }: IcraWizardScreenProps) {
  const t = useTranslations();
  const router = useRouter();
  const permitQuery = usePermit(permitId);
  const matrixQuery = useIcraMatrix();

  const [step, setStep] = useState(0);
  const [activityType, setActivityType] = useState<IcraActivityType>("B");
  const [surroundingAreaIds, setSurroundingAreaIds] = useState<Record<SurroundingSide, string>>({
    ABOVE: "",
    BELOW: "",
    LATERAL: "",
    BEHIND: "",
    IN_FRONT: "",
  });
  const [acknowledgedIds, setAcknowledgedIds] = useState<string[]>([]);
  const [icraResult, setIcraResult] = useState<IcraResult | null>(null);
  const [icraLoading, setIcraLoading] = useState(false);
  const [icraError, setIcraError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [clashWarnings, setClashWarnings] = useState<ShutdownPermit["clashes"]>([]);

  const permit = permitQuery.data;

  const surrounding = useMemo(
    () =>
      SurroundingSideEnum.options.map((side) => ({
        side,
        areaId: surroundingAreaIds[side] || null,
        patientRiskGroup: permit?.affectedAreas.find((a) => a.areaId === surroundingAreaIds[side])?.patientRiskGroup ?? null,
        noteEl: null,
      })),
    [surroundingAreaIds, permit],
  );

  // RULE: computed live, off step 1/2's own state, every time either changes.
  useEffect(() => {
    if (!permit || STEP_IDS[step] !== "class") return;
    let cancelled = false;
    // The state updates below all happen inside this async function's own
    // body, never as a direct statement of the effect callback itself — the
    // effect's job is only to start and cancel it.
    async function evaluate() {
      setIcraLoading(true);
      setIcraError(undefined);
      try {
        const result = await apiMutate(
          "/icra/evaluate",
          "POST",
          {
            activityType,
            affectedAreaIds: permit!.affectedAreas.map((a) => a.areaId),
            surrounding,
            workKind: permit!.workKind,
          },
          IcraResultSchema,
        );
        if (cancelled) return;
        setIcraResult(result);
        setAcknowledgedIds([]);
      } catch (error) {
        if (cancelled) return;
        setIcraError(error instanceof ApiError ? error.message : String(error));
      } finally {
        if (!cancelled) setIcraLoading(false);
      }
    }
    void evaluate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activityType, JSON.stringify(surrounding), permit?.id]);

  async function handleSubmit(): Promise<void> {
    if (!permit || !icraResult) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const updated = await apiMutate<ShutdownPermit>(
        `/permits/${encodeURIComponent(permitId)}/icra`,
        "POST",
        { activityType, surrounding, acknowledgedControlIds: acknowledgedIds },
        ShutdownPermitSchema,
      );
      const afterTransition = await apiMutate<ShutdownPermit>(
        `/permits/${encodeURIComponent(permitId)}/transition`,
        "POST",
        { to: "SUBMITTED" },
        ShutdownPermitSchema,
      );
      setClashWarnings(afterTransition.clashes.length > 0 ? afterTransition.clashes : updated.clashes);
      router.push(`/permits/${encodeURIComponent(permitId)}`);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (permitQuery.error) return <>{noPermission}</>;
  if (permitQuery.isLoading || !permit) {
    return <div aria-busy="true" className="h-s-12 animate-pulse rounded-k bg-k-grey" />;
  }

  // RULE (§6.2): Class II refused for CONSTRUCTION/RENOVATION — Υποβολή
  // stays disabled whether or not every control (there may be none to show)
  // is acknowledged.
  const refused = icraResult?.refusalKey != null;
  const controlsOk = icraResult ? allControlsAcknowledged(icraResult.controls, acknowledgedIds) : false;

  const canContinueByStep: Record<(typeof STEP_IDS)[number], boolean> = {
    activity: true,
    surrounding: true,
    class: Boolean(icraResult) && !refused && controlsOk,
    submit: true,
  };

  const steps = STEP_IDS.map((s) => ({ id: s, label: t(`screens.s12.steps.${s}`) }));

  return (
    <>
      <h1 className="mb-s-5 text-fs-24 text-k-blue-deep">{t("screens.s12.title", { ref: permit.ref ?? "" })}</h1>
      <WizardShell
        steps={steps}
        current={step}
        onBack={() => undefined}
        onNext={() => {
          if (step === STEP_IDS.length - 1) void handleSubmit();
        }}
        canContinue={canContinueByStep[STEP_IDS[step]]}
        onStepChange={(next) => setStep(Math.max(0, Math.min(STEP_IDS.length - 1, next)))}
        submitLabel={t("buttons.submit")}
      >
        {STEP_IDS[step] === "activity" && (
          <fieldset className="grid grid-cols-1 gap-s-3 tablet:grid-cols-2">
            <legend className="sr-only">{t("screens.s12.steps.activity")}</legend>
            {ACTIVITY_TYPES.map((type) => (
              <label
                key={type}
                className={`flex cursor-pointer flex-col gap-s-2 rounded-k border p-s-4 ${
                  activityType === type ? "border-k-blue-deep bg-k-blue-bg" : "border-k-grey"
                }`}
              >
                <span className="flex items-center gap-s-3">
                  <input type="radio" name="activityType" checked={activityType === type} onChange={() => setActivityType(type)} />
                  <span className="text-fs-20 font-bold text-k-ink">{t(`icraActivityType.${type}.label`)}</span>
                </span>
                <span className="text-fs-14 text-k-text">{t(`icraActivityType.${type}.descriptionEl`)}</span>
                <span className="text-fs-12 text-k-text-muted">{t(`icraActivityType.${type}.descriptionEn`)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {STEP_IDS[step] === "surrounding" && (
          <div className="grid gap-s-4">
            <div>
              <p className="text-fs-16 font-bold text-k-ink">{t("screens.s12.affectedAreasTitle")}</p>
              <ul className="mt-s-2 grid gap-s-1 text-fs-14">
                {permit.affectedAreas.map((a) => (
                  <li key={a.areaId}>{a.nameEl} — {t(`riskGroup.${a.patientRiskGroup}`)}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-fs-16 font-bold text-k-ink">{t("screens.s12.surroundingTitle")}</p>
              <div className="mt-s-2 grid grid-cols-1 gap-s-3 tablet:grid-cols-2">
                {SurroundingSideEnum.options.map((side) => (
                  <div key={side} className="flex flex-col gap-s-1">
                    <label htmlFor={`surr-${side}`} className="text-fs-14 text-k-text">{t(`surroundingSide.${side}`)}</label>
                    <select
                      id={`surr-${side}`}
                      value={surroundingAreaIds[side]}
                      onChange={(e) => setSurroundingAreaIds({ ...surroundingAreaIds, [side]: e.target.value })}
                      className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16"
                    >
                      <option value="">{t("screens.s11a.fields.none")}</option>
                      {permit.affectedAreas.map((a) => (
                        <option key={a.areaId} value={a.areaId}>{a.nameEl}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {STEP_IDS[step] === "class" && (
          <div className="grid gap-s-4">
            {icraLoading && <p className="text-fs-14 text-k-text">{t("common.loading")}</p>}
            {icraError && <p role="alert" className="text-fs-14 text-k-red">{icraError}</p>}
            {icraResult && matrixQuery.data && (
              <>
                <div className="flex items-start gap-s-6">
                  <IcraBadge
                    icraClass={icraResult.icraClass}
                    size="wizard"
                    activityType={activityType}
                    riskGroup={t(`riskGroupShort.${icraResult.riskGroup}`)}
                    matrixVersion={icraResult.matrixVersionId}
                  />
                  <IcraMatrixGrid cells={matrixQuery.data.cells} activityType={activityType} riskGroup={icraResult.riskGroup} />
                </div>

                {refused ? (
                  <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-4 text-fs-16 text-k-red">
                    {t(`icraRefusal.${icraResult.refusalKey}`)}
                  </p>
                ) : (
                  <ControlsChecklist
                    controls={icraResult.controls}
                    acknowledgedIds={acknowledgedIds}
                    onToggle={(id) =>
                      setAcknowledgedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
                    }
                  />
                )}
              </>
            )}
          </div>
        )}

        {STEP_IDS[step] === "submit" && (
          <div className="grid gap-s-3 text-fs-14">
            <p><span className="text-k-text-muted">{t("screens.s12.steps.activity")}:</span> {t(`icraActivityType.${activityType}.label`)}</p>
            {icraResult && (
              <p><span className="text-k-text-muted">{t("screens.s11.columns.icraClass")}:</span> {icraResult.icraClass}</p>
            )}
            {submitError && <p role="alert" className="text-fs-14 text-k-red">{submitError}</p>}
            {clashWarnings.length > 0 && (
              <div className="rounded-k border border-k-amber bg-k-amber-bg p-s-4">
                {clashWarnings.map((c) => (
                  <p key={c.otherPermitId} className="text-fs-14 text-k-ink">{t(c.messageKey, { ref: c.otherPermitRef ?? "" })}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </WizardShell>
      {submitting && <p className="mt-s-3 text-fs-12 text-k-text-muted">{t("screens.s11a.saving")}</p>}
    </>
  );
}
