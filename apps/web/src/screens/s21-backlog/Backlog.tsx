"use client";

// S21 «Εκκρεμότητες συντήρησης» — R35, R36 (ADR-0031 §7, §8)
//
/**
 * Backlog — the pure S21 body: the unit × band totals, the item table with
 * its filters, the item drawer (create, edit, «Σε έργο») and the Excel
 * download (the Table's own export button).
 *
 * | Prop         | Type                               | Notes                                                    |
 * |--------------|------------------------------------|----------------------------------------------------------|
 * | summary      | BacklogSummaryRow[]?               |                                                          |
 * | summaryState | "default"\|"loading"\|"error"\|"empty" |                                                      |
 * | data         | {items, total}?                    |                                                          |
 * | state        | BacklogScreenState                 | Five states plus default.                                |
 * | filters      | BacklogFilters                     | Fully controlled.                                        |
 * | canManage    | boolean                            | `canManageBacklog` — add and edit.                       |
 * | canFund      | boolean                            | `canFundBacklog` — «Σε έργο».                            |
 * | onCreate     | (body) => Promise<void>            | POST /backlog                                            |
 * | onPatch      | (id, patch) => Promise<void>       | PATCH /backlog/:id                                       |
 * | onToProject  | (id) => Promise<{projectId, projectCode}> | POST /backlog/:id/to-project                      |
 * | onExport     | () => void                         | GET /backlog/export.xlsx                                 |
 *
 * RULE (ADR-0031 §7): «Σε έργο» drafts a project at the Idea phase with the
 * item's title and cost and funds the item in one step — so it asks first,
 * only an OPEN item offers it, and the result links to the new project.
 * RULE (R36): an auto-drafted item carries why and the order history it was
 * drafted from; both are read-only here.
 */
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { BacklogCreate, BacklogItem, BacklogKind, BacklogPatch, BacklogStatus, BacklogSummaryRow, OrgUnit, RiskBand } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FilterBar, type FilterItem } from "@/components/filter-bar";
import { Table, type TableColumn, type TableState } from "@/components/table";
import type { Locale } from "@/i18n/config";
import { formatDate, formatEURorDash, shortSystemName } from "@/lib/format";
import { BacklogSummary, RISK_BANDS, RiskBandChip } from "./BacklogSummary";

export type BacklogScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface BacklogFilters {
  unit: string;
  band: RiskBand | "";
  status: BacklogStatus[];
  kind: BacklogKind | "";
  autoOnly: boolean;
}

export const NO_BACKLOG_FILTERS: BacklogFilters = { unit: "", band: "", status: [], kind: "", autoOnly: false };

export interface BacklogProps {
  summary?: BacklogSummaryRow[];
  summaryState: "default" | "loading" | "error" | "empty";
  data?: { items: BacklogItem[]; total: number };
  state: BacklogScreenState;
  filters: BacklogFilters;
  orgUnits: OrgUnit[];
  onFilters: (next: BacklogFilters) => void;
  onRetry?: () => void;
  canManage: boolean;
  canFund: boolean;
  onCreate: (body: BacklogCreate) => Promise<void>;
  onPatch: (id: string, patch: BacklogPatch) => Promise<void>;
  onToProject: (id: string) => Promise<{ projectId: string; projectCode: string }>;
  onExport: () => void;
  exporting?: boolean;
  noPermission: ReactNode;
}

const KINDS: BacklogKind[] = ["REPAIR", "REPLACEMENT", "UPGRADE", "STATUTORY"];
const STATUSES: BacklogStatus[] = ["OPEN", "FUNDED", "DONE", "DROPPED"];
const inputClass = "min-h-[44px] w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";
const labelClass = "flex flex-col gap-s-1 text-fs-14 text-k-text";

export function Backlog(props: BacklogProps) {
  const { summary, summaryState, data, state, filters, orgUnits, onFilters, onRetry, canManage, canFund, onExport, noPermission } = props;
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [drawer, setDrawer] = useState<BacklogItem | "new" | null>(null);

  if (state === "noPermission") return <>{noPermission}</>;
  const offline = state === "offline";
  const unitName = (id: string) => {
    const u = orgUnits.find((x) => x.id === id);
    return u ? (locale === "en" ? u.nameEn : u.nameEl) : id;
  };

  const filterItems: FilterItem[] = [
    ...(filters.unit ? [{ key: "unit", label: t("common.unit"), value: unitName(filters.unit) }] : []),
    ...(filters.band ? [{ key: "band", label: t("screens.s21.filters.band"), value: t(`riskBands.${filters.band}`) }] : []),
    ...(filters.status.length ? [{ key: "status", label: t("common.status"), value: filters.status.map((s) => t(`backlogStatus.${s}`)).join(", ") }] : []),
    ...(filters.kind ? [{ key: "kind", label: t("screens.s21.filters.kind"), value: t(`backlogKind.${filters.kind}`) }] : []),
    ...(filters.autoOnly ? [{ key: "auto", label: t("screens.s21.filters.auto"), value: t("common.yes") }] : []),
  ];

  function handleFilterBarChange(next: FilterItem[]) {
    const keys = new Set(next.map((f) => f.key));
    onFilters({
      unit: keys.has("unit") ? filters.unit : "",
      band: keys.has("band") ? filters.band : "",
      status: keys.has("status") ? filters.status : [],
      kind: keys.has("kind") ? filters.kind : "",
      autoOnly: keys.has("auto") ? filters.autoOnly : false,
    });
  }

  const columns: TableColumn<BacklogItem>[] = [
    {
      id: "title",
      headerKey: "screens.s21.columns.title",
      accessor: (row) => row.titleEl,
      cell: (row) => (
        <button type="button" onClick={() => setDrawer(row)} className="text-left text-k-blue hover:underline">
          {row.titleEl}
        </button>
      ),
    },
    { id: "unit", headerKey: "common.unit", accessor: (row) => unitName(row.orgUnitId), defaultHidden: orgUnits.length < 2 },
    { id: "kind", headerKey: "screens.s21.columns.kind", accessor: (row) => row.kind, cell: (row) => t(`backlogKind.${row.kind}`) },
    { id: "band", headerKey: "screens.s21.columns.band", accessor: (row) => RISK_BANDS.indexOf(row.riskBand), cell: (row) => <RiskBandChip band={row.riskBand} /> },
    { id: "cost", headerKey: "screens.s21.columns.cost", accessor: (row) => row.costEstimate ?? -1, numeric: true, cell: (row) => formatEURorDash(row.costEstimate) },
    {
      id: "asset",
      headerKey: "screens.s18.columns.asset",
      accessor: (row) => row.assetTag ?? row.slaSystemName ?? "",
      cell: (row) =>
        row.assetId ? (
          <Link href={`/assets/${encodeURIComponent(row.assetId)}`} className="text-k-blue hover:underline">
            <span className="font-k-mono">{row.assetTag}</span> {row.assetName}
          </Link>
        ) : (
          (row.slaSystemName ? shortSystemName(row.slaSystemName) : t("common.notAvailable"))
        ),
    },
    {
      id: "source",
      headerKey: "screens.s21.columns.source",
      accessor: (row) => (row.autoDrafted ? 0 : 1),
      cell: (row) => (
        <span>
          {row.autoDrafted && row.autoReason ? <span className="block">{t(`backlogAutoReason.${row.autoReason}`)}</span> : null}
          {row.sourceWorkOrderId ? (
            <Link href={`/maintenance/${encodeURIComponent(row.sourceWorkOrderId)}`} className="font-k-mono text-k-blue hover:underline">
              {row.sourceWorkOrderRef ?? row.sourceWorkOrderId}
            </Link>
          ) : !row.autoDrafted ? (
            <span>{row.raisedByName}</span>
          ) : null}
        </span>
      ),
    },
    { id: "status", headerKey: "common.status", accessor: (row) => STATUSES.indexOf(row.status), cell: (row) => t(`backlogStatus.${row.status}`) },
    {
      id: "project",
      headerKey: "screens.s21.columns.project",
      accessor: (row) => row.targetProjectCode ?? "",
      cell: (row) =>
        row.targetProjectId ? (
          <Link href={`/projects/${encodeURIComponent(row.targetProjectId)}`} className="font-k-mono text-k-blue hover:underline">
            {row.targetProjectCode ?? row.targetProjectId}
          </Link>
        ) : (
          t("common.notAvailable")
        ),
    },
  ];

  const tableState: TableState = state === "default" ? "default" : state;

  return (
    <>
      <PageTitle
        eyebrow={
          <Link href="/maintenance" className="hover:underline">
            {t("nav.maintenance")}
          </Link>
        }
        title={t("screens.s21.title")}
        action={
          canManage && !offline ? (
            <button type="button" onClick={() => setDrawer("new")} className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k">
              {t("buttons.add")}
            </button>
          ) : undefined
        }
      />
      <p className="mb-s-5 max-w-[720px] text-fs-16 text-k-text">{t("screens.s21.intro")}</p>
      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <section className="mb-s-6 rounded-k border border-k-grey bg-k-white p-s-4">
        <h2 className="mb-s-3 text-fs-20 text-k-blue-deep">{t("screens.s21.summary.title")}</h2>
        <BacklogSummary rows={summary ?? []} state={summaryState} />
      </section>

      <div className="mb-s-4 flex flex-col gap-s-3">
        <div className="flex flex-wrap items-end gap-s-3">
          <label className={labelClass}>
            {t("common.unit")}
            <select value={filters.unit} onChange={(e) => onFilters({ ...filters, unit: e.target.value })} className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14">
              <option value="">{t("screens.s18.filters.all")}</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitName(u.id)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("screens.s21.filters.band")}
            <select value={filters.band} onChange={(e) => onFilters({ ...filters, band: e.target.value as RiskBand | "" })} className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14">
              <option value="">{t("screens.s18.filters.all")}</option>
              {RISK_BANDS.map((b) => (
                <option key={b} value={b}>
                  {t(`riskBands.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("screens.s21.filters.kind")}
            <select value={filters.kind} onChange={(e) => onFilters({ ...filters, kind: e.target.value as BacklogKind | "" })} className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14">
              <option value="">{t("screens.s18.filters.all")}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`backlogKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-[44px] items-center gap-s-2 text-fs-14 text-k-ink">
            <input type="checkbox" checked={filters.autoOnly} onChange={(e) => onFilters({ ...filters, autoOnly: e.target.checked })} className="h-5 w-5" />
            {t("screens.s21.filters.auto")}
          </label>
        </div>
        {/* One status at a time (owner, 09/10/2026), like S18. */}
        <fieldset role="radiogroup" className="flex flex-wrap items-center gap-s-2">
          <legend className="mb-s-1 text-fs-14 text-k-text">{t("common.status")}</legend>
          {STATUSES.map((s) => {
            const on = filters.status.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => onFilters({ ...filters, status: on ? [] : [s] })}
                className={`min-h-[44px] rounded-k-chip border px-s-3 text-fs-14 ${on ? "border-k-blue-deep bg-k-blue-bg text-k-ink" : "border-k-grey bg-k-white text-k-text"}`}
              >
                {t(`backlogStatus.${s}`)}
              </button>
            );
          })}
        </fieldset>
        <FilterBar filters={filterItems} onChange={handleFilterBarChange} savedViews={[]} onSaveView={() => undefined} />
      </div>

      <Table<BacklogItem>
        tableId="s21-backlog"
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s21.caption"
        state={tableState}
        density="dense"
        onRowOpen={(row) => setDrawer(row)}
        onExport={onExport}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s21.empty", actionLabelKey: "buttons.add", onAction: canManage && !offline ? () => setDrawer("new") : undefined }}
      />

      {drawer && (
        <BacklogDrawer
          key={drawer === "new" ? "new" : drawer.id}
          item={drawer === "new" ? null : drawer}
          orgUnits={orgUnits}
          defaultUnit={filters.unit || (orgUnits.length === 1 ? orgUnits[0].id : "")}
          canManage={canManage && !offline}
          canFund={canFund && !offline}
          onClose={() => setDrawer(null)}
          onCreate={props.onCreate}
          onPatch={props.onPatch}
          onToProject={props.onToProject}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- drawer --

interface DrawerProps {
  item: BacklogItem | null;
  orgUnits: OrgUnit[];
  defaultUnit: string;
  canManage: boolean;
  canFund: boolean;
  onClose: () => void;
  onCreate: (body: BacklogCreate) => Promise<void>;
  onPatch: (id: string, patch: BacklogPatch) => Promise<void>;
  onToProject: (id: string) => Promise<{ projectId: string; projectCode: string }>;
}

/**
 * The item sheet: 480px on the right on desktop, the full screen on a phone
 * (DecisionPanel's shape). Not modal — Esc or «Κλείσιμο» closes it.
 */
export function BacklogDrawer({ item, orgUnits, defaultUnit, canManage, canFund, onClose, onCreate, onPatch, onToProject }: DrawerProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [form, setForm] = useState({
    orgUnitId: item?.orgUnitId ?? defaultUnit,
    kind: item?.kind ?? ("REPAIR" as BacklogKind),
    titleEl: item?.titleEl ?? "",
    descriptionEl: item?.descriptionEl ?? "",
    riskBand: item?.riskBand ?? ("SIGNIFICANT" as RiskBand),
    costEstimate: item?.costEstimate == null ? "" : String(item.costEstimate).replace(".", ","),
    status: item?.status ?? ("OPEN" as BacklogStatus),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [project, setProject] = useState<{ projectId: string; projectCode: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirming]);

  const cost = form.costEstimate.trim() === "" ? null : Number(form.costEstimate.replace(/\./g, "").replace(",", "."));
  const invalid = form.titleEl.trim().length < 3 || (cost !== null && (Number.isNaN(cost) || cost < 0)) || (!item && !form.orgUnitId);
  const editable = canManage;

  async function save() {
    if (invalid) {
      setError(t("screens.s21.drawer.required"));
      return;
    }
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      if (item) {
        await onPatch(item.id, {
          kind: form.kind,
          titleEl: form.titleEl.trim(),
          descriptionEl: form.descriptionEl.trim() || null,
          riskBand: form.riskBand,
          costEstimate: cost,
          status: form.status,
        });
        setSaved(true);
      } else {
        await onCreate({
          orgUnitId: form.orgUnitId,
          kind: form.kind,
          titleEl: form.titleEl.trim(),
          descriptionEl: form.descriptionEl.trim() || null,
          riskBand: form.riskBand,
          costEstimate: cost,
        });
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toProject() {
    if (!item) return;
    setConfirming(false);
    setSaving(true);
    setError(undefined);
    try {
      setProject(await onToProject(item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      aria-labelledby="s21-drawer-title"
      className="fixed inset-0 z-30 overflow-y-auto bg-k-white p-s-5 shadow-k tablet:inset-y-0 tablet:left-auto tablet:right-0 tablet:w-[480px] tablet:border-l tablet:border-k-grey"
    >
      <div className="flex items-start justify-between gap-s-3">
        <h2 id="s21-drawer-title" className="text-fs-20 text-k-blue-deep">
          {item ? item.titleEl : t("screens.s21.drawer.newTitle")}
        </h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-k text-k-text">
          <X size={24} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {item && (
        <dl className="mt-s-3 grid grid-cols-2 gap-s-3 text-fs-14">
          <div>
            <dt className="text-fs-12 text-k-text">{t("screens.s21.drawer.raised")}</dt>
            <dd className="text-k-ink">
              {item.raisedByName} · <span className="num">{formatDate(item.raisedAt)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-fs-12 text-k-text">{t("common.unit")}</dt>
            <dd className="text-k-ink">{(() => {
              const u = orgUnits.find((x) => x.id === item.orgUnitId);
              return u ? (locale === "en" ? u.nameEn : u.nameEl) : item.orgUnitId;
            })()}</dd>
          </div>
          {item.autoDrafted && item.autoReason && (
            <div className="col-span-2">
              <dt className="text-fs-12 text-k-text">{t("screens.s21.drawer.autoReason")}</dt>
              <dd className="text-k-ink">{t(`backlogAutoReason.${item.autoReason}`)}</dd>
            </div>
          )}
          {item.historyEl && (
            <div className="col-span-2">
              <dt className="text-fs-12 text-k-text">{t("screens.s21.drawer.history")}</dt>
              <dd className="num whitespace-pre-line text-left text-k-ink">{item.historyEl}</dd>
            </div>
          )}
        </dl>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="mt-s-4 grid gap-s-3"
      >
        {!item && (
          <label className={labelClass}>
            {t("common.unit")}
            <select value={form.orgUnitId} onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })} className={inputClass}>
              <option value="">{t("screens.s20.pickUnit")}</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {locale === "en" ? u.nameEn : u.nameEl}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={labelClass}>
          {t("screens.s21.columns.title")}
          <input type="text" value={form.titleEl} onChange={(e) => setForm({ ...form, titleEl: e.target.value })} disabled={!editable} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-s-3">
          <label className={labelClass}>
            {t("screens.s21.columns.kind")}
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as BacklogKind })} disabled={!editable} className={inputClass}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`backlogKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("screens.s21.columns.band")}
            <select value={form.riskBand} onChange={(e) => setForm({ ...form, riskBand: e.target.value as RiskBand })} disabled={!editable} className={inputClass}>
              {RISK_BANDS.map((b) => (
                <option key={b} value={b}>
                  {t(`riskBands.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("screens.s21.columns.cost")}
            <input type="text" inputMode="decimal" value={form.costEstimate} onChange={(e) => setForm({ ...form, costEstimate: e.target.value })} disabled={!editable} className={`num ${inputClass}`} />
          </label>
          {item && (
            <label className={labelClass}>
              {t("common.status")}
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BacklogStatus })} disabled={!editable} className={inputClass}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`backlogStatus.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className={labelClass}>
          {t("screens.s21.drawer.description")}
          <textarea value={form.descriptionEl} onChange={(e) => setForm({ ...form, descriptionEl: e.target.value })} disabled={!editable} rows={3} className="w-full rounded-k border border-k-grey p-s-3 text-fs-16 text-k-ink" />
        </label>

        {error && (
          <p role="alert" className="text-fs-14 text-k-red">
            {error}
          </p>
        )}
        {saved && <p className="text-fs-14 text-k-ink">{t("screens.s18detail.saved")}</p>}

        {editable && (
          <div className="flex flex-wrap gap-s-3">
            <button type="submit" disabled={saving} className="min-h-[44px] rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60">
              {t("buttons.save")}
            </button>
            <button type="button" onClick={onClose} className="min-h-[44px] rounded-k px-s-4 text-fs-14 text-k-text">
              {t("buttons.cancel")}
            </button>
          </div>
        )}
      </form>

      {item && (
        <div className="mt-s-5 border-t border-k-grey pt-s-4">
          {project ? (
            <p role="status" className="text-fs-16 text-k-ink">
              {t("screens.s21.toProject.done", { code: project.projectCode })}{" "}
              <Link href={`/projects/${encodeURIComponent(project.projectId)}`} className="text-k-blue hover:underline">
                {t("screens.s21.toProject.open")}
              </Link>
            </p>
          ) : item.targetProjectId ? (
            <p className="text-fs-14 text-k-ink">
              {t("screens.s21.toProject.linked")}{" "}
              <Link href={`/projects/${encodeURIComponent(item.targetProjectId)}`} className="font-k-mono text-k-blue hover:underline">
                {item.targetProjectCode ?? item.targetProjectId}
              </Link>
            </p>
          ) : canFund && item.status === "OPEN" ? (
            <>
              <p className="mb-s-2 text-fs-14 text-k-text">{t("screens.s21.toProject.intro")}</p>
              <button type="button" onClick={() => setConfirming(true)} disabled={saving} className="min-h-[44px] rounded-k border border-k-blue-deep px-s-4 text-fs-14 font-bold text-k-blue-deep">
                {t("screens.s21.toProject.button")}
              </button>
            </>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={t("screens.s21.toProject.confirmTitle")}
        consequence={t("screens.s21.toProject.consequence")}
        destructiveLabel={t("screens.s21.toProject.button")}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void toProject()}
      />
    </aside>
  );
}
