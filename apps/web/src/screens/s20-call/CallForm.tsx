"use client";

// S20 «Καταγραφή κλήσης» — R33 (ADR-0031 §3)
//
/**
 * CallForm — the pure, phone-first S20 form. Fully controlled by
 * `CallFormScreen`, which owns the unit and the four reads that depend on it
 * (the unit's assets, its active agreement, that agreement's SLA systems,
 * its area tree), so this body can be tested on fixtures.
 *
 * | Prop             | Type                        | Notes                                                       |
 * |------------------|-----------------------------|-------------------------------------------------------------|
 * | orgUnits         | OrgUnit[]                   | The unit select.                                            |
 * | unitId           | string                      | Preselected from the switcher's cookie by the page.         |
 * | onUnitChange     | (id) => void                |                                                             |
 * | assets           | AssetListRow[]?             | The unit's register, searched here by tag or name.          |
 * | agreement        | MaintenanceContract \| null | The unit's ACTIVE agreement; null = none (no SLA timers).   |
 * | systems          | SlaSystem[]?                | That agreement's catalogue; only active rows are offered.   |
 * | areaTree         | AreaTree?                   | For the optional area pick.                                 |
 * | defaultSource    | WorkOrderSource             | NURSING for a clinical approver, TECHNICAL_SERVICES else.   |
 * | initialCalledAt  | string?                     | `datetime-local` value; defaults to now.                    |
 * | readOnly         | boolean                     | `!canRaiseWorkOrder`: no submit at all.                     |
 * | submitting/error | —                           | The Screen's POST state; `error` is the API's sentence.     |
 * | onSubmit         | (body: WorkOrderCreate)     | POST /work-orders                                           |
 *
 * RULE (ADR-0031 §3, contract note *): every timer counts from the call,
 * so «Ώρα κλήσης» defaults to now and may be set earlier when the call
 * came by phone and is typed later. The deadlines preview is
 * `addHours(calledAt, hours)` on the chosen system — the same arithmetic
 * the API stamps on the order — shown before anything is saved.
 * RULE: picking an asset brings its area with it; if exactly one active
 * system in the catalogue carries the asset's class, it is preselected
 * (never when there are several: the caller picks).
 * NO PATIENT DATA: the title and details say what is broken and where.
 */
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import {
  addHours,
  type AreaTree,
  type AssetListRow,
  type MaintenanceContract,
  type OrgUnit,
  type SlaSystem,
  type WorkOrderCreate,
  type WorkOrderSource,
} from "@ecapital/shared";
import { AreaPicker } from "@/components/area-picker";
import { PageTitle } from "@/components/app-shell";
import type { Locale } from "@/i18n/config";
import { isoInstantToLocalInput, localInputToIsoInstant } from "@/lib/datetime";
import { formatDateTime } from "@/lib/format";
import { BandChip } from "@/screens/s18-work-orders/BandChip";
import { useHours } from "@/screens/s18-work-orders/hours";

export interface CallFormProps {
  orgUnits: OrgUnit[];
  unitId: string;
  onUnitChange: (id: string) => void;
  assets?: AssetListRow[];
  agreement: MaintenanceContract | null | undefined;
  systems?: SlaSystem[];
  areaTree?: AreaTree;
  defaultSource: WorkOrderSource;
  initialCalledAt?: string;
  readOnly: boolean;
  submitting: boolean;
  error?: string;
  onSubmit: (body: WorkOrderCreate) => void;
  onCancel: () => void;
}

const SOURCES: WorkOrderSource[] = ["NURSING", "TECHNICAL_SERVICES", "VENDOR_ONSITE", "OTHER"];
const inputClass = "min-h-[48px] w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";
const labelClass = "flex flex-col gap-s-1 text-fs-14 text-k-text";

export function CallForm(props: CallFormProps) {
  const { orgUnits, unitId, onUnitChange, assets, agreement, systems, areaTree, defaultSource, initialCalledAt, readOnly, submitting, error, onSubmit, onCancel } = props;
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const hoursText = useHours();

  const [kind, setKind] = useState<"CORRECTIVE" | "STATUTORY">("CORRECTIVE");
  const [assetQuery, setAssetQuery] = useState("");
  const [asset, setAsset] = useState<AssetListRow | null>(null);
  const [noAsset, setNoAsset] = useState(false);
  const [systemId, setSystemId] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<WorkOrderSource>(defaultSource);
  const [calledAt, setCalledAt] = useState(() => initialCalledAt ?? isoInstantToLocalInput(new Date().toISOString()));
  const [assignedTo, setAssignedTo] = useState("");
  const [touched, setTouched] = useState(false);

  const activeSystems = useMemo(() => (systems ?? []).filter((s) => s.active), [systems]);
  const system = activeSystems.find((s) => s.id === systemId) ?? null;

  const matches = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return [];
    return (assets ?? []).filter((a) => a.tag.toLowerCase().includes(q) || a.nameEl.toLowerCase().includes(q)).slice(0, 8);
  }, [assets, assetQuery]);

  function pickAsset(row: AssetListRow) {
    setAsset(row);
    setNoAsset(false);
    setAssetQuery("");
    if (row.areaId) setAreaId(row.areaId);
    if (!systemId) {
      const sameClass = activeSystems.filter((s) => s.assetClass === row.assetClass);
      if (sameClass.length === 1) setSystemId(sameClass[0].id);
    }
  }

  function changeUnit(id: string) {
    onUnitChange(id);
    setAsset(null);
    setSystemId("");
    setAreaId(null);
  }

  const calledIso = calledAt ? localInputToIsoInstant(calledAt) : null;
  const calledValid = calledIso !== null && !Number.isNaN(Date.parse(calledIso));
  const titleValid = title.trim().length >= 3;
  const unitValid = unitId !== "";
  const valid = titleValid && unitValid && calledValid;

  function submit() {
    setTouched(true);
    if (!valid || readOnly) return;
    onSubmit({
      kind,
      source,
      orgUnitId: unitId,
      slaSystemId: system?.id ?? null,
      assetId: asset?.id ?? null,
      areaId,
      titleEl: title.trim(),
      descriptionEl: description.trim() || null,
      calledAt: calledIso ?? undefined,
      assignedToEl: assignedTo.trim() || null,
    });
  }

  const unitName = (u: OrgUnit) => (locale === "en" ? u.nameEn : u.nameEl);

  return (
    <div className="mx-auto max-w-[640px]">
      <PageTitle eyebrow={t("nav.maintenance")} title={t("screens.s20.title")} />
      <p className="mb-s-5 text-fs-16 text-k-text">{t("screens.s20.intro")}</p>
      {readOnly && <p className="mb-s-4 rounded-k bg-k-amber-bg p-s-3 text-fs-16 text-k-ink">{t("screens.s20.readOnly")}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-s-5"
        noValidate
      >
        <label className={labelClass}>
          {t("common.unit")}
          <select value={unitId} onChange={(e) => changeUnit(e.target.value)} className={inputClass} disabled={readOnly}>
            <option value="">{t("screens.s20.pickUnit")}</option>
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {unitName(u)}
              </option>
            ))}
          </select>
        </label>
        {touched && !unitValid && (
          <p role="alert" className="text-fs-14 text-k-red">
            {t("screens.s20.unitRequired")}
          </p>
        )}

        <fieldset className="grid gap-s-2">
          <legend className="mb-s-1 text-fs-14 text-k-text">{t("screens.s20.kind")}</legend>
          <div className="flex gap-s-2">
            {(["CORRECTIVE", "STATUTORY"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                disabled={readOnly}
                className={`min-h-[48px] flex-1 rounded-k border px-s-3 text-fs-16 ${kind === k ? "border-k-blue-deep bg-k-blue-bg text-k-ink" : "border-k-grey bg-k-white text-k-text"}`}
              >
                {t(`workOrderKind.${k}`)}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Asset: search by tag or name, or «Χωρίς πάγιο». */}
        <div className="grid gap-s-2">
          <span className="text-fs-14 text-k-text">{t("screens.s20.asset")}</span>
          {asset ? (
            <div className="flex flex-wrap items-center justify-between gap-s-2 rounded-k border border-k-blue-deep bg-k-blue-bg p-s-3">
              <span className="text-fs-16 text-k-ink">
                <span className="font-k-mono">{asset.tag}</span> {asset.nameEl}
                {asset.areaNameEl ? <span className="block text-fs-14 text-k-text">{asset.areaNameEl}</span> : null}
              </span>
              <button type="button" onClick={() => setAsset(null)} disabled={readOnly} className="min-h-[44px] rounded-k px-s-3 text-fs-14 text-k-blue-deep">
                {t("screens.s20.changeAsset")}
              </button>
            </div>
          ) : noAsset ? (
            <div className="flex flex-wrap items-center justify-between gap-s-2 rounded-k border border-k-grey p-s-3">
              <span className="text-fs-16 text-k-ink">{t("screens.s20.noAsset")}</span>
              <button type="button" onClick={() => setNoAsset(false)} disabled={readOnly} className="min-h-[44px] rounded-k px-s-3 text-fs-14 text-k-blue-deep">
                {t("screens.s20.changeAsset")}
              </button>
            </div>
          ) : (
            <>
              <label className="relative block">
                <span className="sr-only">{t("screens.s20.assetSearch")}</span>
                <Search size={20} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute left-s-3 top-1/2 -translate-y-1/2 text-k-text" />
                <input
                  type="search"
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                  placeholder={t("screens.s20.assetSearch")}
                  disabled={readOnly || !unitValid}
                  className={`${inputClass} pl-s-8`}
                />
              </label>
              {matches.length > 0 && (
                <ul className="grid gap-s-1 rounded-k border border-k-grey">
                  {matches.map((row) => (
                    <li key={row.id}>
                      <button type="button" onClick={() => pickAsset(row)} className="flex min-h-[48px] w-full flex-col items-start px-s-3 py-s-2 text-left hover:bg-k-surface">
                        <span className="text-fs-16 text-k-ink">
                          <span className="font-k-mono">{row.tag}</span> {row.nameEl}
                        </span>
                        {row.areaNameEl && <span className="text-fs-14 text-k-text">{row.areaNameEl}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {assetQuery.trim() && matches.length === 0 && <p className="text-fs-14 text-k-text">{t("screens.s20.assetNone")}</p>}
              <button
                type="button"
                onClick={() => setNoAsset(true)}
                disabled={readOnly}
                className="min-h-[44px] justify-self-start rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep"
              >
                {t("screens.s20.noAsset")}
              </button>
            </>
          )}
        </div>

        {/* System from the unit's active agreement. */}
        {unitValid && agreement === null ? (
          <p className="rounded-k bg-k-amber-bg p-s-3 text-fs-14 text-k-ink">{t("screens.s20.noAgreement")}</p>
        ) : (
          <label className={labelClass}>
            {t("screens.s20.system")}
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)} className={inputClass} disabled={readOnly || activeSystems.length === 0}>
              <option value="">{t("screens.s20.pickSystem")}</option>
              {activeSystems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.nameEl} · {t(`slaBand.${s.band}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {system && (
          <div className="grid gap-s-1 rounded-k border border-k-grey p-s-3">
            <div className="flex flex-wrap items-center gap-s-2">
              <BandChip band={system.band} />
              <span className="text-fs-14 text-k-text">
                {t("screens.s20.systemHours", {
                  response: hoursText(system.responseHours),
                  restore: hoursText(system.restoreHours),
                  report: hoursText(system.reportHours),
                })}
              </span>
            </div>
          </div>
        )}

        <div className="grid gap-s-1">
          <label className={labelClass}>
            {t("screens.s20.titleLabel")}
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-describedby="s20-title-hint" className={inputClass} disabled={readOnly} />
          </label>
          <p id="s20-title-hint" className="text-fs-14 text-k-text">
            {t("screens.s20.titleHint")}
          </p>
          {touched && !titleValid && (
            <p role="alert" className="text-fs-14 text-k-red">
              {t("screens.s20.titleRequired")}
            </p>
          )}
        </div>

        <div className="grid gap-s-1">
          <label className={labelClass}>
            {t("screens.s20.description")}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
              aria-describedby="s20-description-hint"
              className="w-full rounded-k border border-k-grey p-s-3 text-fs-16 text-k-ink"
              disabled={readOnly}
            />
          </label>
          <p id="s20-description-hint" className="text-fs-14 text-k-text">
            {t("screens.s20.noPatientData")}
          </p>
        </div>

        <details className="rounded-k border border-k-grey p-s-3">
          <summary className="flex min-h-[44px] cursor-pointer items-center text-fs-16 text-k-blue-deep">
            {t("screens.s20.area")}
            {areaId && <Check size={20} strokeWidth={1.5} aria-hidden="true" className="ml-s-2 text-k-green" />}
          </summary>
          <div className="mt-s-3">
            {areaTree ? (
              <AreaPicker areaTree={areaTree} selectedAreaIds={areaId ? [areaId] : []} onToggle={(id) => setAreaId(id)} mode="single" />
            ) : (
              <p className="text-fs-14 text-k-text">{t("screens.s20.areaNeedsUnit")}</p>
            )}
          </div>
        </details>

        <label className={labelClass}>
          {t("screens.s20.source")}
          <select value={source} onChange={(e) => setSource(e.target.value as WorkOrderSource)} className={inputClass} disabled={readOnly}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`workOrderSource.${s}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-s-1">
          <label className={labelClass}>
            {t("screens.s20.calledAt")}
            <input
              type="datetime-local"
              value={calledAt}
              onChange={(e) => setCalledAt(e.target.value)}
              aria-describedby="s20-called-hint"
              className={`num ${inputClass}`}
              disabled={readOnly}
            />
          </label>
          <p id="s20-called-hint" className="text-fs-14 text-k-text">
            {t("screens.s20.calledAtHint")}
          </p>
        </div>

        <label className={labelClass}>
          {t("screens.s20.assignedTo")}
          <input type="text" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} maxLength={200} className={inputClass} disabled={readOnly} />
        </label>

        {/* RULE (ADR-0031 §3): the deadlines, before saving. */}
        <section aria-labelledby="s20-deadlines" className="rounded-k bg-k-surface p-s-4">
          <h2 id="s20-deadlines" className="text-fs-16 font-bold text-k-blue-deep">
            {t("screens.s20.preview.title")}
          </h2>
          {system && calledValid && calledIso ? (
            <dl className="mt-s-2 grid gap-s-2">
              {(
                [
                  ["response", system.responseHours],
                  ["restore", system.restoreHours],
                  ["report", system.reportHours],
                ] as const
              ).map(([key, hours]) => (
                <div key={key} className="flex flex-wrap justify-between gap-s-2">
                  <dt className="text-fs-14 text-k-text">{t(`screens.s20.preview.${key}`)}</dt>
                  <dd className="num text-fs-16 text-k-ink" data-testid={`deadline-${key}`}>
                    {formatDateTime(addHours(calledIso, hours))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s20.preview.none")}</p>
          )}
        </section>

        {error && (
          <p role="alert" className="text-fs-14 text-k-red">
            {error}
          </p>
        )}

        {!readOnly && (
          <div className="flex flex-col-reverse gap-s-3 tablet:flex-row tablet:justify-end">
            <button type="button" onClick={onCancel} className="min-h-[56px] rounded-k px-s-5 text-fs-16 text-k-text">
              {t("buttons.cancel")}
            </button>
            <button type="submit" disabled={submitting} className="min-h-[56px] rounded-k bg-k-blue px-s-5 text-fs-16 font-bold text-k-white shadow-k disabled:opacity-60">
              {submitting ? t("screens.s18detail.saving") : t("buttons.submit")}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
