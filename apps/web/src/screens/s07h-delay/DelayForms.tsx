"use client";

// S07h — ADR-0035
//
// The three small forms on «Προθεσμίες και ρήτρες»: a section, an extension
// of time and the activation of a penalty on one clock. Each is a panel
// above the lists, not a route; the pure `Delay` screen decides which one is
// open.
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { ExtensionApprover, type ContractSection } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import {
  ActivationFormSchema,
  ExtensionFormSchema,
  SectionFormSchema,
  type ActivationFormValues,
  type ExtensionFormValues,
  type SectionFormValues,
} from "./schema";

const INPUT = "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-s-1">
      <label htmlFor={id} className="text-fs-14 text-k-text">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-fs-14 text-k-red">
          {error}
        </p>
      )}
    </div>
  );
}

function Panel({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section role="dialog" aria-label={title} className="mb-s-6 max-w-[640px] rounded-k border border-k-grey bg-k-white p-s-5 shadow-k">
      <h2 className="text-fs-20">{title}</h2>
      {intro && <p className="mt-s-2 text-fs-14 text-k-text">{intro}</p>}
      <div className="mt-s-4">{children}</div>
    </section>
  );
}

function Actions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  const t = useTranslations();
  return (
    <div className="mt-s-2 flex flex-wrap items-center gap-s-3">
      <button
        type="submit"
        disabled={saving}
        className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
      >
        {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
        {t("buttons.save")}
      </button>
      <button type="button" onClick={onCancel} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text">
        {t("buttons.cancel")}
      </button>
    </div>
  );
}

function ApiErrorLine({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
      {message}
    </p>
  );
}

function useFieldError<T extends object>(errors: Partial<Record<keyof T, { message?: unknown }>>) {
  const t = useTranslations();
  return (key: keyof T): string | undefined => {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  };
}

// ------------------------------------------------------------------ section

export interface SectionFormProps {
  section?: ContractSection;
  saving: boolean;
  apiError?: string;
  onSave: (values: SectionFormValues) => void;
  onCancel: () => void;
}

export function SectionForm({ section, saving, apiError, onSave, onCancel }: SectionFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SectionFormValues>({
    resolver: zodResolver<SectionFormValues>(SectionFormSchema),
    defaultValues: {
      code: section?.code ?? "",
      titleEl: section?.titleEl ?? "",
      completionDate: section?.completionDate ?? "",
      handoverDate: section?.handoverDate ?? "",
      liquidatedDamagesPerDay: section?.liquidatedDamagesPerDay ?? null,
    },
  });
  const err = useFieldError<SectionFormValues>(errors);
  const P = "screens.s07h.sections";
  return (
    <Panel title={section ? t(`${P}.editTitle`) : t(`${P}.add`)}>
      <form onSubmit={handleSubmit((values) => onSave(values))} className="flex flex-col gap-s-4">
        <div className="grid gap-s-4 tablet:grid-cols-[120px_1fr]">
          <Field id="sec-code" label={t(`${P}.fields.code`)} error={err("code")}>
            <input id="sec-code" {...register("code")} aria-invalid={errors.code ? "true" : undefined} className={INPUT} />
          </Field>
          <Field id="sec-title" label={t(`${P}.fields.title`)} error={err("titleEl")}>
            <input id="sec-title" {...register("titleEl")} aria-invalid={errors.titleEl ? "true" : undefined} className={INPUT} />
          </Field>
        </div>
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <Field id="sec-completion" label={t(`${P}.fields.completion`)} error={err("completionDate")}>
            <input id="sec-completion" type="date" {...register("completionDate")} className={INPUT} />
          </Field>
          <Field id="sec-handover" label={t(`${P}.fields.handover`)}>
            <input id="sec-handover" type="date" {...register("handoverDate")} className={INPUT} />
          </Field>
        </div>
        <Field id="sec-rate" label={t(`${P}.fields.rate`)} error={err("liquidatedDamagesPerDay")}>
          <input
            id="sec-rate"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            {...register("liquidatedDamagesPerDay", { setValueAs: (value: string) => (value === "" || value == null ? null : Number(value)) })}
            className={`num w-[220px] ${INPUT}`}
          />
        </Field>
        <ApiErrorLine message={apiError} />
        <Actions saving={saving} onCancel={onCancel} />
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------- extension

export interface ExtensionFormProps {
  sections: ContractSection[];
  saving: boolean;
  apiError?: string;
  onSave: (values: ExtensionFormValues) => void;
  onCancel: () => void;
}

export function ExtensionForm({ sections, saving, apiError, onSave, onCancel }: ExtensionFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExtensionFormValues>({
    resolver: zodResolver<ExtensionFormValues>(ExtensionFormSchema),
    defaultValues: {
      sectionId: "",
      days: undefined as unknown as number,
      approvedAt: "",
      approver: "",
      approverNameEl: "",
      reasonEl: "",
      contractorCulpable: "",
    },
  });
  const err = useFieldError<ExtensionFormValues>(errors);
  const P = "screens.s07h.extensions";
  return (
    <Panel title={t(`${P}.addTitle`)}>
      <form onSubmit={handleSubmit((values) => onSave(values))} className="flex flex-col gap-s-4">
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <Field id="ext-section" label={t(`${P}.fields.section`)}>
            <select id="ext-section" {...register("sectionId")} className={INPUT}>
              <option value="">{t(`${P}.wholeContract`)}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.titleEl}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ext-days" label={t(`${P}.fields.days`)} error={err("days")}>
            <input
              id="ext-days"
              type="number"
              step="1"
              min="1"
              inputMode="numeric"
              {...register("days", { setValueAs: (value: string) => (value === "" || value == null ? NaN : Number(value)) })}
              aria-invalid={errors.days ? "true" : undefined}
              className={`num ${INPUT}`}
            />
          </Field>
        </div>
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <Field id="ext-date" label={t(`${P}.fields.approvedAt`)} error={err("approvedAt")}>
            <input id="ext-date" type="date" {...register("approvedAt")} className={INPUT} />
          </Field>
          <Field id="ext-approver" label={t(`${P}.fields.approver`)} error={err("approver")}>
            <select id="ext-approver" {...register("approver")} className={INPUT}>
              <option value="" />
              {ExtensionApprover.options.map((option) => (
                <option key={option} value={option}>
                  {t(`extensionApprover.${option}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="ext-name" label={t(`${P}.fields.approverName`)} error={err("approverNameEl")}>
          <input id="ext-name" {...register("approverNameEl")} className={INPUT} />
        </Field>
        <Field id="ext-reason" label={t(`${P}.fields.reason`)} error={err("reasonEl")}>
          <textarea id="ext-reason" rows={3} {...register("reasonEl")} className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink" />
        </Field>
        <fieldset className="flex flex-col gap-s-1">
          <legend className="text-fs-14 text-k-text">{t(`${P}.fields.culpable`)}</legend>
          <div className="flex gap-s-5">
            <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
              <input type="radio" value="yes" {...register("contractorCulpable")} />
              {t("common.yes")}
            </label>
            <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
              <input type="radio" value="no" {...register("contractorCulpable")} />
              {t("common.no")}
            </label>
          </div>
          {err("contractorCulpable") && (
            <p role="alert" className="text-fs-14 text-k-red">
              {err("contractorCulpable")}
            </p>
          )}
        </fieldset>
        <ApiErrorLine message={apiError} />
        <Actions saving={saving} onCancel={onCancel} />
      </form>
    </Panel>
  );
}

// --------------------------------------------------------------- activation

export interface ActivationFormProps {
  clockLabel: string;
  saving: boolean;
  apiError?: string;
  onSave: (values: ActivationFormValues) => void;
  onCancel: () => void;
}

export function ActivationForm({ clockLabel, saving, apiError, onSave, onCancel }: ActivationFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ActivationFormValues>({
    resolver: zodResolver<ActivationFormValues>(ActivationFormSchema),
    defaultValues: { activatedAt: "", noteEl: "" },
  });
  const err = useFieldError<ActivationFormValues>(errors);
  const P = "screens.s07h.activation";
  return (
    <Panel title={t(`${P}.title`)} intro={t(`${P}.intro`)}>
      <form onSubmit={handleSubmit((values) => onSave(values))} className="flex flex-col gap-s-4">
        <p className="text-fs-14 text-k-ink">
          <span className="text-k-text">{t(`${P}.clock`)}: </span>
          {clockLabel}
        </p>
        <Field id="act-date" label={t(`${P}.date`)} error={err("activatedAt")}>
          <input id="act-date" type="date" {...register("activatedAt")} className={`w-[220px] ${INPUT}`} />
        </Field>
        <Field id="act-note" label={t(`${P}.note`)} error={err("noteEl")}>
          <textarea id="act-note" rows={3} {...register("noteEl")} className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink" />
        </Field>
        <ApiErrorLine message={apiError} />
        <Actions saving={saving} onCancel={onCancel} />
      </form>
    </Panel>
  );
}
