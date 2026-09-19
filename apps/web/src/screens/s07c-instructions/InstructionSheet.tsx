"use client";

// S07c — R09 (ADR-0017)
//
/**
 * InstructionSheet — the row-open sheet for one site instruction, or the
 * "new" form (`instruction` omitted).
 *
 * - no `instruction` → the **new** form (text + cost-impact checkbox).
 * - existing → the full text, who issued it and when, and the same
 *   «Δημιουργία τροποποίησης» action the table row offers — RULE
 *   (ADR-0017): only with cost impact, and only once; a linked instruction
 *   shows the link to its variation instead, and a costImpactFlag with no
 *   variation and no write access shows neither.
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
 */
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import type { SiteInstruction } from "@ecapital/shared";
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
}: InstructionSheetProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InstructionFormValues>({
    resolver: zodResolver<InstructionFormValues>(InstructionFormSchema),
    defaultValues: { textEl: "", costImpactFlag: false },
  });

  if (!open) return null;

  if (!instruction) {
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form onSubmit={handleSubmit((values) => onCreate(values))} className="flex flex-col gap-s-4">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="instr-text" className="text-fs-14 text-k-text">
              {t("screens.s07c.fields.text")}
            </label>
            <textarea
              id="instr-text"
              rows={3}
              {...register("textEl")}
              aria-invalid={errors.textEl ? "true" : undefined}
              className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
            />
            {errors.textEl && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.textEl.message as string)}
              </p>
            )}
          </div>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
            <input type="checkbox" {...register("costImpactFlag")} />
            {t("screens.s07c.fields.costImpact")}
          </label>
          {apiError && (
            <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}
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

  return (
    <SheetShell title={t("screens.s07c.columns.instruction")} onClose={onClose}>
      <dl className="grid gap-s-4 text-fs-14">
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.text")}</dt>
          <dd className="text-k-ink">{instruction.textEl}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.columns.issuedBy")}</dt>
          <dd className="text-k-ink">
            {instruction.issuedByName} · {formatDate(instruction.issuedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.columns.costImpact")}</dt>
          <dd className="text-k-ink">{instruction.costImpactFlag ? t("common.yes") : t("common.no")}</dd>
        </div>
      </dl>

      {instruction.variationId ? (
        <p className="mt-s-4 text-fs-14">
          {variationNumber !== undefined ? t("screens.s07c.variationLink", { number: variationNumber }) : t("common.notAvailable")}
        </p>
      ) : instruction.costImpactFlag && canWrite ? (
        <button
          type="button"
          onClick={onCreateVariation}
          disabled={creatingVariation}
          className="mt-s-4 flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          {creatingVariation && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {t("screens.s07c.createVariation")}
        </button>
      ) : null}

      {apiError && (
        <p role="alert" className="mt-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}
    </SheetShell>
  );
}
