"use client";

// S18b — R32 (ADR-0031 «a month of PM orders without a spreadsheet»)
//
/**
 * SchedulesSection — the preventive programme: one line per system (or one
 * asset of it), its frequency, the next date and the open PM order, with an
 * add/edit form and «Έκδοση τώρα».
 *
 * | Prop        | Type                                   | Notes                                               |
 * |-------------|----------------------------------------|-----------------------------------------------------|
 * | schedules   | PmSchedule[]?                          |                                                     |
 * | state       | TableState                             |                                                     |
 * | systems     | SlaSystem[]                            | The form's system select (active ones).             |
 * | assets      | AssetListRow[]                         | The form's optional asset select.                   |
 * | canManage   | boolean                                | Add, edit, «Έκδοση τώρα».                           |
 * | onSave      | (write, id?) => Promise<void>          | POST /maintenance/schedules or PATCH …/:id.         |
 * | onGenerate  | () => Promise<PmGenerationResult>      | POST /maintenance/schedules/generate                |
 *
 * RULE (contract `PmSchedule`): one open PM order per schedule at a time,
 * so re-running «Έκδοση τώρα» never doubles an order — the result line says
 * how many were skipped because one was already open.
 */
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AssetListRow, PmFrequency, PmGenerationResult, PmSchedule, PmScheduleWrite, SlaSystem } from "@ecapital/shared";
import { Table, type TableColumn, type TableState } from "@/components/table";
import { formatDate, shortSystemName } from "@/lib/format";

export interface SchedulesSectionProps {
  schedules?: PmSchedule[];
  state: TableState;
  systems: SlaSystem[];
  assets: AssetListRow[];
  canManage: boolean;
  offline: boolean;
  onSave: (write: PmScheduleWrite, id?: string) => Promise<void>;
  onGenerate: () => Promise<PmGenerationResult>;
  onRetry?: () => void;
}

const FREQUENCIES: PmFrequency[] = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"];
const inputClass = "min-h-[44px] w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";
const labelClass = "flex flex-col gap-s-1 text-fs-14 text-k-text";

interface FormValue {
  slaSystemId: string;
  assetId: string;
  titleEl: string;
  frequency: PmFrequency;
  nextDue: string;
  leadDays: string;
  checklistEl: string;
  active: boolean;
}

function toForm(s: PmSchedule | null): FormValue {
  return {
    slaSystemId: s?.slaSystemId ?? "",
    assetId: s?.assetId ?? "",
    titleEl: s?.titleEl ?? "",
    frequency: s?.frequency ?? "MONTHLY",
    nextDue: s?.nextDue ?? "",
    leadDays: String(s?.leadDays ?? 5),
    checklistEl: s?.checklistEl ?? "",
    active: s?.active ?? true,
  };
}

export function SchedulesSection({ schedules, state, systems, assets, canManage, offline, onSave, onGenerate, onRetry }: SchedulesSectionProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState<PmSchedule | "new" | null>(null);
  const [form, setForm] = useState<FormValue>(toForm(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<PmGenerationResult | null>(null);

  const writable = canManage && !offline;

  function open(target: PmSchedule | "new") {
    setForm(toForm(target === "new" ? null : target));
    setError(undefined);
    setEditing(target);
  }

  const lead = Number(form.leadDays);
  const valid = form.slaSystemId && form.titleEl.trim().length > 0 && form.nextDue && Number.isInteger(lead) && lead >= 0 && lead <= 90;

  async function save() {
    if (!valid) {
      setError(t("screens.s18plan.schedules.required"));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSave(
        {
          slaSystemId: form.slaSystemId,
          assetId: form.assetId || null,
          titleEl: form.titleEl.trim(),
          frequency: form.frequency,
          nextDue: form.nextDue,
          leadDays: lead,
          checklistEl: form.checklistEl.trim() || null,
          active: form.active,
        },
        editing && editing !== "new" ? editing.id : undefined,
      );
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setError(undefined);
    try {
      setGenerated(await onGenerate());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const columns: TableColumn<PmSchedule>[] = [
    {
      id: "system",
      headerKey: "screens.s18.columns.system",
      accessor: (row) => row.slaSystemCode,
      cell: (row) => (
        <span>
          <span className="font-k-mono">{row.slaSystemCode}</span> {shortSystemName(row.slaSystemName)}
        </span>
      ),
    },
    {
      id: "asset",
      headerKey: "screens.s18.columns.asset",
      accessor: (row) => row.assetTag ?? "",
      cell: (row) => (row.assetTag ? `${row.assetTag}${row.assetName ? ` ${row.assetName}` : ""}` : t("common.notAvailable")),
    },
    { id: "title", headerKey: "screens.s18.columns.title", accessor: (row) => row.titleEl },
    { id: "frequency", headerKey: "screens.s18plan.schedules.columns.frequency", accessor: (row) => FREQUENCIES.indexOf(row.frequency), cell: (row) => t(`pmFrequency.${row.frequency}`) },
    { id: "nextDue", headerKey: "screens.s18plan.schedules.columns.nextDue", accessor: (row) => row.nextDue, numeric: true, cell: (row) => formatDate(row.nextDue) },
    {
      id: "openOrder",
      headerKey: "screens.s18plan.schedules.columns.openOrder",
      accessor: (row) => row.openWorkOrderId ?? "",
      cell: (row) =>
        row.openWorkOrderId ? (
          <Link href={`/maintenance/${encodeURIComponent(row.openWorkOrderId)}`} className="text-k-blue hover:underline">
            {t("screens.s18plan.schedules.openOrderLink")}
          </Link>
        ) : (
          t("common.notAvailable")
        ),
    },
    { id: "active", headerKey: "screens.s18plan.catalogue.columns.active", accessor: (row) => (row.active ? 1 : 0), cell: (row) => (row.active ? t("common.yes") : t("common.no")) },
    ...(writable
      ? [
          {
            id: "edit",
            headerKey: "buttons.edit",
            accessor: () => "",
            sortable: false,
            cell: (row: PmSchedule) => (
              <button type="button" onClick={() => open(row)} className="min-h-[44px] text-fs-14 text-k-blue hover:underline">
                {t("buttons.edit")}
              </button>
            ),
          } satisfies TableColumn<PmSchedule>,
        ]
      : []),
  ];

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="mb-s-3 flex flex-wrap items-start justify-between gap-s-3">
        <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s18plan.schedules.title")}</h2>
        {writable && (
          <div className="flex flex-wrap gap-s-3">
            <button type="button" onClick={() => open("new")} className="min-h-[44px] rounded-k border border-k-grey px-s-4 text-fs-14 text-k-blue-deep">
              {t("buttons.add")}
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating}
              className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {generating ? t("screens.s18detail.saving") : t("screens.s18plan.schedules.generate")}
            </button>
          </div>
        )}
      </div>
      <p className="mb-s-3 text-fs-14 text-k-text">{t("screens.s18plan.schedules.intro")}</p>

      {generated && (
        <p role="status" className="mb-s-3 rounded-k bg-k-blue-bg p-s-3 text-fs-16 text-k-ink">
          {t("screens.s18plan.schedules.generated", { generated: generated.generated, skipped: generated.skippedOpen, escalated: generated.escalated })}
        </p>
      )}

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="mb-s-4 grid grid-cols-1 gap-s-3 rounded-k border border-k-grey p-s-4 tablet:grid-cols-2"
        >
          <h3 className="text-fs-16 font-bold text-k-blue-deep tablet:col-span-2">
            {editing === "new" ? t("screens.s18plan.schedules.newTitle") : t("screens.s18plan.schedules.editTitle")}
          </h3>
          <label className={labelClass}>
            {t("screens.s18.columns.system")}
            <select value={form.slaSystemId} onChange={(e) => setForm({ ...form, slaSystemId: e.target.value })} className={inputClass}>
              <option value="">{t("screens.s20.pickSystem")}</option>
              {systems
                .filter((s) => s.active || s.id === form.slaSystemId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.nameEl}
                  </option>
                ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("screens.s18.columns.asset")}
            <select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })} className={inputClass}>
              <option value="">{t("screens.s18plan.schedules.wholeSystem")}</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tag} {a.nameEl}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} tablet:col-span-2`}>
            {t("screens.s18.columns.title")}
            <input type="text" value={form.titleEl} onChange={(e) => setForm({ ...form, titleEl: e.target.value })} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("screens.s18plan.schedules.columns.frequency")}
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as PmFrequency })} className={inputClass}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`pmFrequency.${f}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("screens.s18plan.schedules.columns.nextDue")}
            <input type="date" value={form.nextDue} onChange={(e) => setForm({ ...form, nextDue: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className={labelClass}>
            {t("screens.s18plan.schedules.leadDays")}
            <input type="number" min={0} max={90} value={form.leadDays} onChange={(e) => setForm({ ...form, leadDays: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-5 w-5" />
            {t("screens.s18plan.catalogue.columns.active")}
          </label>
          <label className={`${labelClass} tablet:col-span-2`}>
            {t("screens.s18plan.schedules.checklist")}
            <textarea value={form.checklistEl} onChange={(e) => setForm({ ...form, checklistEl: e.target.value })} rows={4} className="w-full rounded-k border border-k-grey p-s-3 text-fs-16 text-k-ink" />
          </label>
          {error && (
            <p role="alert" className="text-fs-14 text-k-red tablet:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-s-3 tablet:col-span-2">
            <button type="submit" disabled={saving} className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60">
              {t("buttons.save")}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="min-h-[44px] rounded-k px-s-4 text-fs-14 text-k-text">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      )}
      {!editing && error && (
        <p role="alert" className="mb-s-3 text-fs-14 text-k-red">
          {error}
        </p>
      )}

      <Table<PmSchedule>
        tableId="s18b-schedules"
        columns={columns}
        rows={schedules ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s18plan.schedules.title"
        state={state}
        density="dense"
        onExport={() => undefined}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s18plan.schedules.empty", actionLabelKey: "buttons.add", onAction: writable ? () => open("new") : undefined }}
      />
    </section>
  );
}
