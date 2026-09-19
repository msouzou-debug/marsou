"use client";

// S08 — R10 (ADR-0015)
//
/**
 * VariationSheet — the row-open sheet for one variation, or for a brand new
 * one (`variation` omitted). Which of five things it shows is computed here,
 * not passed in, from the variation's own status plus who is looking:
 *
 * - no `variation` at all → the **new** form (`VariationCreate`'s four
 *   fields), «Αποθήκευση» only — there is nothing to submit until it exists.
 * - `DRAFT` or `RETURNED`, and the caller is the raiser (or an admin) →
 *   the **edit** form, «Αποθήκευση» and «Υποβολή» (behind a `ConfirmDialog`).
 *   RETURNED also shows the decision comment above the form — the reason
 *   the raiser is here again (ADR-0015: "a return always carries a comment").
 * - `SUBMITTED`, and the caller may decide (`estates_head`/`admin`) *or is
 *   the variation's own raiser* → the **decide** panel (`DecisionPanel`,
 *   exactly three facts), plus the quiet «Απόρριψη» link. RULE (R10): when
 *   the caller is the raiser — possible for `admin`, who may do both, and
 *   shown to a `project_engineer` raiser too even though that role could
 *   never decide anything at all — the panel's own buttons are disabled up
 *   front (`DecisionPanel`'s `disabled`/`disabledReason`, comparing `meUserId`
 *   to `raisedByName` — see the route's own header comment for why not an
 *   id) with `errors.sameUserApproval`'s own sentence, rather
 *   than waiting for the API to refuse it. This makes the segregation rule
 *   visible to the person it actually restricts, not only to a decider who
 *   happens to also be the raiser.
 * - `SUBMITTED`, raised by someone else, and the caller may not decide → a
 *   plain **awaiting** view.
 * - `APPROVED` or `REJECTED` → a read-only **final** view with the decision
 *   comment. RULE (ADR-0015): a rejected variation is never re-opened —
 *   this is the only view it ever gets.
 *
 * | Prop               | Type                        | Notes                                             |
 * |--------------------|-----------------------------|------------------------------------------------------|
 * | open               | boolean                     |                                                        |
 * | variation          | Variation?                  | Omit for the "new" form.                              |
 * | contractCurrentValue | number                    | For the decision panel's third fact.                  |
 * | meUserId              | string                      | `me.userId` — who is looking, compared against `raisedById` (the app_user row id the API also stores). |
 * | canDecide          | boolean                     | `canDecideVariations(roles)`.                          |
 * | canEdit            | boolean                     | `canRaiseVariations(roles)` — gates the "new"/"edit" forms. |
 * | saving             | boolean                     |                                                        |
 * | apiError           | string?                     |                                                        |
 * | onClose            | () => void                  |                                                        |
 * | onSave             | (values) => void            | Create (no `variation`) or update (PATCH).             |
 * | onSubmit           | () => void                  | `POST .../submit`, after the `ConfirmDialog`.          |
 * | onDecide           | (decision, comment) => void | `POST .../decide`.                                    |
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import type { Variation, VariationDecision as VariationDecisionType } from "@ecapital/shared";
import { VariationReason } from "@ecapital/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DecisionPanel } from "@/components/decision-panel";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate, formatEUR } from "@/lib/format";
import { VariationFormSchema, type VariationFormValues } from "./schema";

export interface VariationSheetProps {
  open: boolean;
  variation?: Variation;
  contractNo: string;
  contractCurrentValue: number;
  meUserId: string;
  canDecide: boolean;
  canEdit: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onSave: (values: VariationFormValues) => void;
  onSubmit: () => void;
  onDecide: (decision: VariationDecisionType["decision"], comment: string | null) => void;
}

function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px] flex flex-col bg-k-white shadow-k"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="rounded-k p-s-2 text-k-text hover:bg-k-surface"
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-auto p-s-5">{children}</div>
    </div>
  );
}

export function VariationSheet({
  open,
  variation,
  contractNo,
  contractCurrentValue,
  meUserId,
  canDecide,
  canEdit,
  saving = false,
  apiError,
  onClose,
  onSave,
  onSubmit,
  onDecide,
}: VariationSheetProps) {
  const t = useTranslations();
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VariationFormValues>({
    resolver: zodResolver<VariationFormValues>(VariationFormSchema),
    defaultValues: {
      descriptionEl: variation?.descriptionEl ?? "",
      reason: variation?.reason ?? "OTHER",
      value: variation?.value ?? 0,
      timeImpactDays: variation?.timeImpactDays ?? 0,
    },
  });

  if (!open) return null;

  function fieldError(key: keyof VariationFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  const isNew = !variation;
  // NOTE (flagged, not guessed): the API also lets an administrator edit a
  // DRAFT/RETURNED variation on the raiser's behalf (`mustBeRaiser(...,
  // {allowAdmin:true})`). This build's UI does not surface that path — the
  // sheet only opens the edit form for the raiser themselves — since
  // nothing in the brief asks for an "edit on someone else's behalf"
  // control; an admin who needs it can still reach the endpoint directly.
  const isRaiser = variation ? variation.raisedById === meUserId : true;
  const editableStatus = isNew || variation?.status === "DRAFT" || variation?.status === "RETURNED";

  // ---------------------------------------------------------- new / edit --
  if (editableStatus && (isNew ? canEdit : canEdit && isRaiser)) {
    const title = isNew ? t("buttons.add") : t("screens.s08.sheetEditTitle", { number: variation?.number ?? 0 });
    return (
      <SheetShell title={title} onClose={onClose}>
        {variation?.status === "RETURNED" && variation.decisionCommentEl && (
          <div className="mb-s-4 rounded-k border border-k-amber bg-k-amber-bg p-s-3">
            <p className="text-fs-12 font-bold text-k-ink">{t("screens.s08.decisionComment")}</p>
            <p className="text-fs-14 text-k-ink">{variation.decisionCommentEl}</p>
            <p className="mt-s-1 text-fs-12 text-k-text">{t("screens.s08.returnedNote")}</p>
          </div>
        )}
        <form onSubmit={handleSubmit((values) => onSave(values))} className="flex flex-col gap-s-4">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="vs-description" className="text-fs-14 text-k-text">
              {t("screens.s08.fields.description")}
            </label>
            <textarea
              id="vs-description"
              rows={3}
              {...register("descriptionEl")}
              aria-invalid={errors.descriptionEl ? "true" : undefined}
              className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
            />
            {fieldError("descriptionEl") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("descriptionEl")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="vs-reason" className="text-fs-14 text-k-text">
              {t("screens.s08.fields.reason")}
            </label>
            <select
              id="vs-reason"
              {...register("reason")}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            >
              {VariationReason.options.map((option) => (
                <option key={option} value={option}>
                  {t(`variationReasons.${option}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="vs-value" className="text-fs-14 text-k-text">
              {t("screens.s08.fields.value")}
            </label>
            <input
              id="vs-value"
              type="number"
              step="0.01"
              inputMode="decimal"
              {...register("value", { setValueAs: (value: string) => (value === "" ? NaN : Number(value)) })}
              aria-invalid={errors.value ? "true" : undefined}
              className="num h-11 w-[220px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("value") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("value")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="vs-time" className="text-fs-14 text-k-text">
              {t("screens.s08.fields.timeImpactDays")}
            </label>
            <input
              id="vs-time"
              type="number"
              step="1"
              inputMode="numeric"
              {...register("timeImpactDays", { setValueAs: (value: string) => (value === "" ? NaN : Number(value)) })}
              aria-invalid={errors.timeImpactDays ? "true" : undefined}
              className="num h-11 w-[160px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("timeImpactDays") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("timeImpactDays")}
              </p>
            )}
          </div>

          {apiError && (
            <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}

          <div className="mt-s-2 flex flex-wrap items-center gap-s-3">
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              {t("buttons.save")}
            </button>
            {!isNew && (
              <button
                type="button"
                onClick={() => setConfirmSubmitOpen(true)}
                disabled={saving}
                className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-text disabled:opacity-60"
              >
                {t("buttons.submit")}
              </button>
            )}
          </div>
        </form>

        <ConfirmDialog
          open={confirmSubmitOpen}
          title={t("screens.s08.submitConfirmTitle")}
          consequence={t("screens.s08.submitConfirmConsequence")}
          destructiveLabel={t("buttons.submit")}
          onCancel={() => setConfirmSubmitOpen(false)}
          onConfirm={() => {
            setConfirmSubmitOpen(false);
            onSubmit();
          }}
        />
      </SheetShell>
    );
  }

  // Not editable by this caller (someone else's draft/returned variation, or
  // a role that cannot raise/edit at all): fall through to the read-only
  // views below by treating it like any other non-actionable state.
  if (variation?.status === "SUBMITTED") {
    const selfRaised = variation.raisedById === meUserId;
    // RULE (R10, ADR-0015): a raiser sees the segregation rule applied to
    // *their own* submitted work even when their role could never decide
    // anything at all (a `project_engineer` never gets `canDecide`) — the
    // disabled panel and its sentence make "you cannot approve your own
    // variation" visible to the person the rule actually restricts, not
    // only to a decider (`estates_head`/`admin`) who happens to also be the
    // raiser. Anyone else's submitted variation still shows the plain
    // "awaiting" view below when the caller cannot decide.
    if (canDecide || selfRaised) {
      return (
        <DecisionPanel
          what={t("screens.s08.sheetEditTitle", { number: variation.number })}
          where={contractNo}
          facts={[
            { label: t("screens.s08.decisionFacts.value"), value: formatEUR(variation.value) },
            { label: t("screens.s08.decisionFacts.reason"), value: t(`variationReasons.${variation.reason}`) },
            {
              label: t("screens.s08.decisionFacts.newCurrentValue"),
              value: formatEUR(contractCurrentValue + variation.value),
            },
          ]}
          disabled={selfRaised}
          disabledReason={selfRaised ? t("screens.s08.sameUserApprovalHint") : undefined}
          onApprove={() => onDecide("APPROVED", null)}
          onReturn={(comment) => onDecide("RETURNED", comment)}
          onClose={onClose}
          belowFooter={!selfRaised ? <RejectLink onConfirm={(comment) => onDecide("REJECTED", comment)} /> : undefined}
        />
      );
    }
    return (
      <SheetShell title={t("screens.s08.sheetEditTitle", { number: variation.number })} onClose={onClose}>
        <p className="text-fs-14 text-k-text">{t("screens.s08.awaitingDecision")}</p>
      </SheetShell>
    );
  }

  // ------------------------------------------------------------- final --
  if (variation) {
    return (
      <SheetShell title={t("screens.s08.sheetEditTitle", { number: variation.number })} onClose={onClose}>
        <dl className="grid gap-s-3 text-fs-14">
          <div>
            <dt className="text-k-text">{t("screens.s08.fields.description")}</dt>
            <dd className="text-k-ink">{variation.descriptionEl}</dd>
          </div>
          <div>
            <dt className="text-k-text">{t("screens.s08.fields.reason")}</dt>
            <dd className="text-k-ink">{t(`variationReasons.${variation.reason}`)}</dd>
          </div>
          <div>
            <dt className="text-k-text">{t("screens.s08.fields.value")}</dt>
            <dd className={`num ${variation.value < 0 ? "text-k-red" : "text-k-ink"}`}>{formatEUR(variation.value)}</dd>
          </div>
          <div>
            <dt className="text-k-text">{t("screens.s08.columns.status")}</dt>
            <dd className="text-k-ink">{t(`variationStatus.${variation.status}`)}</dd>
          </div>
          {variation.decidedByName && (
            <div>
              <dt className="text-k-text">{t("screens.s08.columns.decision")}</dt>
              <dd className="num text-k-ink">
                {variation.decidedByName} · {variation.decidedAt ? formatDate(variation.decidedAt) : ""}
              </dd>
            </div>
          )}
          {variation.decisionCommentEl && (
            <div>
              <dt className="text-k-text">{t("screens.s08.decisionComment")}</dt>
              <dd className="text-k-ink">{variation.decisionCommentEl}</dd>
            </div>
          )}
        </dl>
        {variation.status === "REJECTED" && (
          <p className="mt-s-4 text-fs-12 text-k-text-muted">{t("screens.s08.rejectedFinal")}</p>
        )}
      </SheetShell>
    );
  }

  return null;
}

// A separate export so `VariationsScreen` can render the quiet «Απόρριψη»
// link *below* the DecisionPanel's own footer (build brief: "a third quiet
// link"). It is not a `buttons.*` verb — see `schema`'s header comment in
// `i18n` — so it renders as a link, never as a button styled like the fixed
// set, and is exported on its own so it can sit outside `DecisionPanel`'s DOM.
export function RejectLink({
  onConfirm,
}: {
  onConfirm: (comment: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-fs-12 text-k-text underline-offset-2 hover:underline"
      >
        {t("screens.s08.rejectLink")}
      </button>
    );
  }

  return (
    <div className="mt-s-3 rounded-k border border-k-grey p-s-3">
      <label htmlFor="reject-comment" className="text-fs-12 text-k-text">
        {t("screens.s08.rejectCommentLabel")}
      </label>
      <textarea
        id="reject-comment"
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="mt-s-1 w-full rounded-k border border-k-grey p-s-2 text-fs-14"
      />
      {!comment.trim() && <p className="mt-s-1 text-fs-12 text-k-text-muted">{t("screens.s08.rejectCommentRequired")}</p>}
      <button
        type="button"
        disabled={!comment.trim()}
        onClick={() => onConfirm(comment)}
        className="mt-s-2 text-fs-12 font-bold text-k-red underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-k-text-muted"
      >
        {t("screens.s08.rejectLink")}
      </button>
    </div>
  );
}
