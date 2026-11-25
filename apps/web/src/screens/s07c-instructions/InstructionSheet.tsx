"use client";

// S07c — R09 (ADR-0017)
//
/**
 * InstructionSheet — the row-open sheet for one site instruction, or the
 * "new" form (`instruction` omitted).
 *
 * - no `instruction` → the **new** form (text, issue day, cost-impact
 *   checkbox). The issue day defaults to today and may be earlier: an
 *   instruction given on site on Monday is often typed in on Wednesday.
 * - existing → the **read view**: number, full text, who issued it and when,
 *   cost impact and the linked variation (UAT 25/11/2026 — the row used to
 *   open on Enter only), and the same «Δημιουργία τροποποίησης» action the
 *   table row offers — RULE (ADR-0017): only with cost impact, and only
 *   once; a linked instruction shows the link to its variation instead, and a
 *   costImpactFlag with no variation and no write access shows neither.
 * - «Επεξεργασία» (writers, and only when `onUpdate` is wired) → the **edit
 *   form**, the same fields as the new one. RULE (R09, UAT 25/11/2026): not
 *   once the instruction has become a variation — the variation is the record
 *   of what it cost from then on (the API: errors.siteInstructionSettled).
 * - RULE (owner, UAT 25/11/2026): the issue day is not after today, said
 *   under the field before the API says it again (errors.dateInFuture).
 *
 * | Prop            | Type                              | Notes                                    |
 * |-----------------|-----------------------------------|--------------------------------------------|
 * | open            | boolean                           |                                              |
 * | instruction     | SiteInstruction?                  | Omit for the "new" form.                    |
 * | variationNumber | number?                           | The linked variation's own number, if any.  |
 * | canWrite        | boolean                           | `canWriteSiteInstructions(roles)`.          |
 * | creatingVariation | boolean?                        |                                              |
 * | saving          | boolean?                          |                                              |
 * | apiError        | string?                           |                                              |
 * | onClose         | () => void                        |                                              |
 * | onCreate        | (values: InstructionFormValues) => void |                                    |
 * | onCreateVariation | () => void                      |                                              |
 * | onUpdate        | (values) => Promise<boolean>?     | `PATCH`; true on success, which returns the sheet to the read view. |
 */
import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import { nicosiaDateOf, type SiteInstruction } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import { InstructionFormSchema, type InstructionFormValues } from "./schema";

export interface InstructionSheetProps {
  open: boolean;
  instruction?: SiteInstruction;
  variationNumber?: number;
  canWrite: boolean;
  creatingVariation?: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onCreate: (values: InstructionFormValues) => void;
  onCreateVariation: () => void;
  onUpdate?: (values: InstructionFormValues) => Promise<boolean>;
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTranslations();
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px] flex flex-col bg-k-white shadow-k"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-k p-s-2 text-k-text hover:bg-k-surface">
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-auto p-s-5">{children}</div>
    </div>
  );
}

function valuesOf(instruction: SiteInstruction | undefined): InstructionFormValues {
  return instruction
    ? { textEl: instruction.textEl, costImpactFlag: instruction.costImpactFlag, issuedOn: nicosiaDateOf(instruction.issuedAt) }
    : { textEl: "", costImpactFlag: false, issuedOn: nicosiaDateOf(new Date()) };
}

/** Text, issue day and cost impact — the new form and the edit form are the same fields. */
function InstructionFields({ form, idPrefix }: { form: UseFormReturn<InstructionFormValues>; idPrefix: string }) {
  const t = useTranslations();
  const errors = form.formState.errors;
  return (
    <>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-text`} className="text-fs-14 text-k-text">
          {t("screens.s07c.fields.text")}
        </label>
        <textarea
          id={`${idPrefix}-text`}
          rows={3}
          {...form.register("textEl")}
          aria-invalid={errors.textEl ? "true" : undefined}
          className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
        />
        {errors.textEl && (
          <p role="alert" className="text-fs-14 text-k-red">
            {t(errors.textEl.message as string)}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-issued-on`} className="text-fs-14 text-k-text">
          {t("screens.s07c.fields.issuedOn")}
        </label>
        <input
          id={`${idPrefix}-issued-on`}
          type="date"
          max={nicosiaDateOf(new Date())}
          {...form.register("issuedOn")}
          aria-invalid={errors.issuedOn ? "true" : undefined}
          className="num h-11 w-[200px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        />
        {errors.issuedOn && (
          <p role="alert" className="text-fs-14 text-k-red">
            {t(errors.issuedOn.message as string)}
          </p>
        )}
      </div>
      <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
        <input type="checkbox" {...form.register("costImpactFlag")} />
        {t("screens.s07c.fields.costImpact")}
      </label>
    </>
  );
}

export function InstructionSheet({
  open,
  instruction,
  variationNumber,
  canWrite,
  creatingVariation = false,
  saving = false,
  apiError,
  onClose,
  onCreate,
  onCreateVariation,
  onUpdate,
}: InstructionSheetProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const form = useForm<InstructionFormValues>({
    resolver: zodResolver<InstructionFormValues>(InstructionFormSchema),
    defaultValues: valuesOf(instruction),
  });

  if (!open) return null;

  const errorBox = apiError && (
    <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
      {apiError}
    </p>
  );

  if (!instruction) {
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form noValidate onSubmit={form.handleSubmit((values) => onCreate(values))} className="flex flex-col gap-s-4">
          <InstructionFields form={form} idPrefix="instr" />
          {errorBox}
          <button
            type="submit"
            disabled={saving}
            className="mt-s-2 flex h-11 w-fit items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("buttons.save")}
          </button>
        </form>
      </SheetShell>
    );
  }

  const settled = instruction.variationId !== null;
  const canEdit = canWrite && !!onUpdate && !settled;

  if (editing && canEdit) {
    return (
      <SheetShell title={t("screens.s07c.editTitle", { number: instruction.number })} onClose={onClose}>
        <form
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            if (await onUpdate(values)) setEditing(false);
          })}
          className="flex flex-col gap-s-4"
        >
          <InstructionFields form={form} idPrefix="instr-edit" />
          {errorBox}
          <div className="mt-s-2 flex items-center gap-s-3">
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              {t("buttons.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </SheetShell>
    );
  }

  return (
    <SheetShell title={t("screens.s07c.sheetTitle", { number: instruction.number })} onClose={onClose}>
      <dl className="grid gap-s-4 text-fs-14">
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.number")}</dt>
          <dd className="num text-k-ink">{instruction.number}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.text")}</dt>
          <dd className="whitespace-pre-line text-k-ink">{instruction.textEl}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.issuedBy")}</dt>
          <dd className="text-k-ink">{instruction.issuedByName}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.issuedOn")}</dt>
          <dd className="num text-k-ink">{formatDate(instruction.issuedAt)}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.columns.costImpact")}</dt>
          <dd className="text-k-ink">{instruction.costImpactFlag ? t("common.yes") : t("common.no")}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.variation")}</dt>
          <dd className="text-k-ink">
            {settled && variationNumber !== undefined ? t("screens.s07c.variationLink", { number: variationNumber }) : t("common.notAvailable")}
          </dd>
        </div>
      </dl>

      <div className="mt-s-4 flex flex-wrap items-center gap-s-3">
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              form.reset(valuesOf(instruction));
              setEditing(true);
            }}
            disabled={saving}
            className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
          >
            {t("buttons.edit")}
          </button>
        )}
        {!settled && instruction.costImpactFlag && canWrite && (
          <button
            type="button"
            onClick={onCreateVariation}
            disabled={creatingVariation}
            className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {creatingVariation && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("screens.s07c.createVariation")}
          </button>
        )}
      </div>

      {settled && canWrite && <p className="mt-s-4 text-fs-14 text-k-text">{t("screens.s07c.settledNoEdit")}</p>}

      {apiError && <div className="mt-s-4">{errorBox}</div>}
    </SheetShell>
  );
}
