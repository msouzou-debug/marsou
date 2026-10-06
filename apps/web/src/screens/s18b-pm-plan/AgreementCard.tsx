"use client";

// S18b — R32 (ADR-0031 §1)
//
/**
 * AgreementCard — the unit's umbrella maintenance agreement: contractor,
 * reference, dates, 24/7 cover, normal hours and the availability clause,
 * with an inline form (create or edit) for the head of estates and admin.
 *
 * | Prop        | Type                                    | Notes                                         |
 * |-------------|-----------------------------------------|-----------------------------------------------|
 * | agreement   | MaintenanceContract \| null             | null: the unit has none yet.                  |
 * | unitId      | string                                  | The create form's unit.                       |
 * | contractors | Contractor[]                            | The register; blacklisted ones are not offered.|
 * | canManage   | boolean                                 | `canManageMaintenanceContract`.               |
 * | onSave      | (write, id?) => Promise<void>           | POST /maintenance/contracts or PATCH …/:id.   |
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Contractor, MaintenanceContract, MaintenanceContractWrite } from "@ecapital/shared";
import { formatDate, formatEUR, formatEURorDash, formatInt, formatPct } from "@/lib/format";

export interface AgreementCardProps {
  agreement: MaintenanceContract | null;
  unitId: string;
  contractors: Contractor[];
  canManage: boolean;
  offline: boolean;
  onSave: (write: MaintenanceContractWrite, id?: string) => Promise<void>;
}

const inputClass = "min-h-[44px] w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";
const labelClass = "flex flex-col gap-s-1 text-fs-14 text-k-text";

function toForm(a: MaintenanceContract | null) {
  return {
    contractorId: a?.contractorId ?? "",
    ref: a?.ref ?? "",
    titleEl: a?.titleEl ?? "",
    startDate: a?.startDate ?? "",
    endDate: a?.endDate ?? "",
    roundTheClock: a?.roundTheClock ?? true,
    normalHoursFrom: a?.normalHoursFrom ?? "07:30",
    normalHoursTo: a?.normalHoursTo ?? "15:00",
    availabilityHoursYear: String(a?.availabilityHoursYear ?? 8600),
    availabilityPenaltyCriticalPerHour: String(a?.availabilityPenaltyCriticalPerHour ?? 5).replace(".", ","),
    availabilityPenaltyOtherPerHour: String(a?.availabilityPenaltyOtherPerHour ?? 1).replace(".", ","),
    penaltyCapPct: String(a?.penaltyCapPct ?? 10).replace(".", ","),
    contractValue: a?.contractValue == null ? "" : String(a.contractValue).replace(".", ","),
    status: a?.status ?? "ACTIVE",
  };
}

const num = (v: string) => Number(v.trim().replace(",", "."));

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-fs-12 text-k-text">{label}</dt>
      <dd className="text-fs-16 text-k-ink">{value}</dd>
    </div>
  );
}

export function AgreementCard({ agreement, unitId, contractors, canManage, offline, onSave }: AgreementCardProps) {
  const t = useTranslations("screens.s18plan.agreement");
  const tb = useTranslations("buttons");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(agreement));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const required = form.contractorId && form.ref.trim() && form.titleEl.trim() && form.startDate;
  const numbersOk = [form.availabilityHoursYear, form.availabilityPenaltyCriticalPerHour, form.availabilityPenaltyOtherPerHour, form.penaltyCapPct].every((v) => !Number.isNaN(num(v)) && num(v) >= 0) && (form.contractValue.trim() === "" || num(form.contractValue) >= 0);

  async function save() {
    if (!required || !numbersOk) {
      setError(t("required"));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSave(
        {
          orgUnitId: agreement?.orgUnitId ?? unitId,
          contractorId: form.contractorId,
          ref: form.ref.trim(),
          titleEl: form.titleEl.trim(),
          startDate: form.startDate,
          endDate: form.endDate || null,
          roundTheClock: form.roundTheClock,
          normalHoursFrom: form.normalHoursFrom,
          normalHoursTo: form.normalHoursTo,
          availabilityHoursYear: Math.round(num(form.availabilityHoursYear)),
          availabilityPenaltyCriticalPerHour: num(form.availabilityPenaltyCriticalPerHour),
          availabilityPenaltyOtherPerHour: num(form.availabilityPenaltyOtherPerHour),
          penaltyCapPct: num(form.penaltyCapPct),
          contractValue: form.contractValue.trim() === "" ? null : num(form.contractValue),
          status: form.status,
        },
        agreement?.id,
      );
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const open = () => {
    setForm(toForm(agreement));
    setError(undefined);
    setEditing(true);
  };

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex flex-wrap items-start justify-between gap-s-3">
        <h2 className="text-fs-20 text-k-blue-deep">{t("title")}</h2>
        {canManage && !offline && !editing && (
          <button type="button" onClick={open} className="min-h-[44px] rounded-k border border-k-grey px-s-4 text-fs-14 text-k-blue-deep">
            {agreement ? tb("edit") : tb("add")}
          </button>
        )}
      </div>

      {!editing && !agreement && <p className="mt-s-3 text-fs-16 text-k-text">{t("none")}</p>}

      {!editing && agreement && (
        <dl className="mt-s-3 grid grid-cols-1 gap-s-4 tablet:grid-cols-3">
          <Fact label={t("contractor")} value={agreement.contractorName} />
          <Fact label={t("ref")} value={`${agreement.ref} · ${agreement.titleEl}`} />
          <Fact
            label={t("period")}
            value={`${formatDate(agreement.startDate)} – ${agreement.endDate ? formatDate(agreement.endDate) : t("open")}`}
          />
          <Fact label={t("cover")} value={agreement.roundTheClock ? t("roundTheClock") : t("normalOnly")} />
          <Fact label={t("normalHours")} value={`${agreement.normalHoursFrom}–${agreement.normalHoursTo}`} />
          <Fact label={t("value")} value={formatEURorDash(agreement.contractValue)} />
          <div className="tablet:col-span-3">
            <Fact
              label={t("availability")}
              value={t("availabilityText", {
                hours: formatInt(agreement.availabilityHoursYear),
                critical: formatEUR(agreement.availabilityPenaltyCriticalPerHour),
                other: formatEUR(agreement.availabilityPenaltyOtherPerHour),
                cap: formatPct(agreement.penaltyCapPct, 0),
              })}
            />
          </div>
        </dl>
      )}

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="mt-s-3 grid grid-cols-1 gap-s-3 tablet:grid-cols-3"
        >
          <label className={labelClass}>
            {t("contractor")}
            <select value={form.contractorId} onChange={(e) => setForm({ ...form, contractorId: e.target.value })} className={inputClass}>
              <option value="">{t("pickContractor")}</option>
              {contractors
                .filter((c) => !c.blacklisted || c.id === form.contractorId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("ref")}
            <input type="text" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("titleLabel")}
            <input type="text" value={form.titleEl} onChange={(e) => setForm({ ...form, titleEl: e.target.value })} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("startDate")}
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("endDate")}
            <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("status")}
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "ACTIVE" | "ENDED" })} className={inputClass}>
              <option value="ACTIVE">{t("statusActive")}</option>
              <option value="ENDED">{t("statusEnded")}</option>
            </select>
          </label>
          <label className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
            <input type="checkbox" checked={form.roundTheClock} onChange={(e) => setForm({ ...form, roundTheClock: e.target.checked })} className="h-5 w-5" />
            {t("roundTheClock")}
          </label>
          <label className={labelClass}>
            {t("normalFrom")}
            <input type="time" value={form.normalHoursFrom} onChange={(e) => setForm({ ...form, normalHoursFrom: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("normalTo")}
            <input type="time" value={form.normalHoursTo} onChange={(e) => setForm({ ...form, normalHoursTo: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("availabilityHours")}
            <input type="text" inputMode="numeric" value={form.availabilityHoursYear} onChange={(e) => setForm({ ...form, availabilityHoursYear: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("penaltyCritical")}
            <input type="text" inputMode="decimal" value={form.availabilityPenaltyCriticalPerHour} onChange={(e) => setForm({ ...form, availabilityPenaltyCriticalPerHour: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("penaltyOther")}
            <input type="text" inputMode="decimal" value={form.availabilityPenaltyOtherPerHour} onChange={(e) => setForm({ ...form, availabilityPenaltyOtherPerHour: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("cap")}
            <input type="text" inputMode="decimal" value={form.penaltyCapPct} onChange={(e) => setForm({ ...form, penaltyCapPct: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("value")}
            <input type="text" inputMode="decimal" value={form.contractValue} onChange={(e) => setForm({ ...form, contractValue: e.target.value })} className={`num ${inputClass}`} />
          </label>
          {error && (
            <p role="alert" className="text-fs-14 text-k-red tablet:col-span-3">
              {error}
            </p>
          )}
          <div className="flex gap-s-3 tablet:col-span-3">
            <button type="submit" disabled={saving} className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60">
              {tb("save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] rounded-k px-s-4 text-fs-14 text-k-text">
              {tb("cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
