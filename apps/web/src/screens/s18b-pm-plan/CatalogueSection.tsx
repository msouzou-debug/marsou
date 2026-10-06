"use client";

// S18b — R32 (ADR-0031 §2)
//
/**
 * CatalogueSection — the agreement's SLA catalogue as a Table, with inline
 * edit of the hours and the rates, the active switch, and the Excel import
 * (template download, upload, the importer's result).
 *
 * | Prop          | Type                               | Notes                                                      |
 * |---------------|------------------------------------|------------------------------------------------------------|
 * | agreementId   | string                             | For the template link.                                     |
 * | systems       | SlaSystem[]?                       |                                                            |
 * | state         | TableState                         |                                                            |
 * | canManage     | boolean                            | Inline edit, the switch and the import.                    |
 * | onPatch       | (id, patch) => Promise<void>       | PATCH /maintenance/systems/:id                             |
 * | onImport      | (file) => Promise<SlaImportResult> | POST /maintenance/contracts/:id/systems/import (multipart) |
 *
 * RULE (ADR-0031 §2): the three penalty rates are nullable on purpose — the
 * Nicosia copy lost its amounts. A null rate is «—», never «0 €», and the
 * section says «Ρήτρες προς επιβεβαίωση» while any is missing. Clearing a
 * rate cell (empty or «—») sends null back.
 * RULE (CONVENTIONS "Screens"): the table's export button is always there;
 * for the catalogue it downloads the import template, which is the
 * catalogue's own Excel shape.
 */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Upload } from "lucide-react";
import type { SlaImportResult, SlaSystem, SlaSystemWrite } from "@ecapital/shared";
import { Table, type TableColumn, type TableState } from "@/components/table";
import { formatEURorDash, formatInt } from "@/lib/format";
import { BandChip } from "@/screens/s18-work-orders/BandChip";
import { useHours } from "@/screens/s18-work-orders/hours";

export interface CatalogueSectionProps {
  agreementId: string;
  systems?: SlaSystem[];
  state: TableState;
  canManage: boolean;
  onPatch: (id: string, patch: Partial<SlaSystemWrite>) => Promise<void>;
  onImport: (file: File) => Promise<SlaImportResult>;
  onRetry?: () => void;
}

type HourKey = "responseHours" | "restoreHours" | "reportHours";
type RateKey = "penaltyPmPerDay" | "penaltyResponsePerHour" | "penaltyRestorePerHour";

/** "1,5" → 1.5; "" / "—" → null; anything else unparseable → NaN. */
export function parseCell(value: string): number | null {
  const v = value.trim();
  if (v === "" || v === "—") return null;
  return Number(v.replace(/\s|€/g, "").replace(",", "."));
}

export function templateHref(agreementId: string): string {
  return `/api/proxy/maintenance/contracts/${encodeURIComponent(agreementId)}/systems/template.xlsx`;
}

export function CatalogueSection({ agreementId, systems, state, canManage, onPatch, onImport, onRetry }: CatalogueSectionProps) {
  const t = useTranslations();
  const hours = useHours();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<SlaImportResult | null>(null);
  const [error, setError] = useState<string | undefined>();

  const ratesMissing = (systems ?? []).some((s) => s.penaltyPmPerDay === null || s.penaltyResponsePerHour === null || s.penaltyRestorePerHour === null);

  async function patch(id: string, body: Partial<SlaSystemWrite>) {
    setError(undefined);
    try {
      await onPatch(id, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function cellEdit(row: SlaSystem, columnId: string, value: string) {
    const parsed = parseCell(value);
    if (columnId === "responseHours" || columnId === "restoreHours" || columnId === "reportHours") {
      if (parsed === null || Number.isNaN(parsed) || parsed <= 0) {
        setError(t("screens.s18plan.catalogue.hoursInvalid"));
        return;
      }
      void patch(row.id, { [columnId as HourKey]: parsed });
      return;
    }
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      setError(t("screens.s18plan.catalogue.rateInvalid"));
      return;
    }
    void patch(row.id, { [columnId as RateKey]: parsed });
  }

  async function runImport() {
    if (!file) return;
    setImporting(true);
    setError(undefined);
    setResult(null);
    try {
      setResult(await onImport(file));
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const hourCol = (id: HourKey, headerKey: string): TableColumn<SlaSystem> => ({
    id,
    headerKey,
    accessor: (row) => row[id],
    numeric: true,
    editable: canManage,
    cell: (row) => hours(row[id]),
  });
  const rateCol = (id: RateKey, headerKey: string): TableColumn<SlaSystem> => ({
    id,
    headerKey,
    accessor: (row) => row[id] ?? "",
    numeric: true,
    editable: canManage,
    cell: (row) => formatEURorDash(row[id]),
  });

  const columns: TableColumn<SlaSystem>[] = [
    { id: "code", headerKey: "screens.s18plan.catalogue.columns.code", accessor: (row) => row.code, cell: (row) => <span className="font-k-mono">{row.code}</span> },
    { id: "name", headerKey: "screens.s18plan.catalogue.columns.name", accessor: (row) => row.nameEl },
    { id: "band", headerKey: "screens.s18.columns.band", accessor: (row) => ["CRITICAL", "P1", "P2"].indexOf(row.band), cell: (row) => <BandChip band={row.band} /> },
    hourCol("responseHours", "screens.s18.columns.response"),
    hourCol("restoreHours", "screens.s18.columns.restore"),
    hourCol("reportHours", "screens.s18.columns.report"),
    {
      id: "frequencies",
      headerKey: "screens.s18plan.catalogue.columns.frequencies",
      accessor: (row) => row.pmFrequencies.join(","),
      cell: (row) => (row.pmFrequencies.length ? row.pmFrequencies.map((f) => t(`pmFrequency.${f}`)).join(", ") : t("common.notAvailable")),
    },
    rateCol("penaltyPmPerDay", "screens.s18plan.catalogue.columns.ratePm"),
    rateCol("penaltyResponsePerHour", "screens.s18plan.catalogue.columns.rateResponse"),
    rateCol("penaltyRestorePerHour", "screens.s18plan.catalogue.columns.rateRestore"),
    {
      id: "active",
      headerKey: "screens.s18plan.catalogue.columns.active",
      accessor: (row) => (row.active ? 1 : 0),
      cell: (row) =>
        canManage ? (
          <input
            type="checkbox"
            checked={row.active}
            aria-label={t("screens.s18plan.catalogue.activeFor", { code: row.code })}
            onChange={(e) => void patch(row.id, { active: e.target.checked })}
            className="h-5 w-5"
          />
        ) : row.active ? (
          t("common.yes")
        ) : (
          t("common.no")
        ),
    },
  ];

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="mb-s-3 flex flex-wrap items-start justify-between gap-s-3">
        <div>
          <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s18plan.catalogue.title")}</h2>
          {systems && <p className="text-fs-14 text-k-text">{t("screens.s18plan.catalogue.count", { count: formatInt(systems.length) })}</p>}
        </div>
        {ratesMissing && (
          <p role="note" className="rounded-k-chip bg-k-amber-bg px-s-3 py-s-2 text-fs-14 text-k-ink">
            {t("screens.s18plan.catalogue.ratesHint")}
          </p>
        )}
      </div>
      {canManage && <p className="mb-s-3 text-fs-14 text-k-text">{t("screens.s18plan.catalogue.editHint")}</p>}

      <Table<SlaSystem>
        tableId="s18b-catalogue"
        columns={columns}
        rows={systems ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s18plan.catalogue.title"
        state={state}
        density="dense"
        onCellEdit={canManage ? cellEdit : undefined}
        onExport={() => {
          window.location.href = templateHref(agreementId);
        }}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s18plan.catalogue.empty", actionLabelKey: "buttons.add", onAction: canManage ? () => fileRef.current?.click() : undefined }}
      />

      {error && (
        <p role="alert" className="mt-s-3 text-fs-14 text-k-red">
          {error}
        </p>
      )}

      {canManage && (
        <div className="mt-s-4 grid gap-s-3 border-t border-k-grey pt-s-4">
          <h3 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s18plan.import.title")}</h3>
          <p className="text-fs-14 text-k-text">{t("screens.s18plan.import.intro")}</p>
          <div className="flex flex-wrap items-center gap-s-3">
            <a href={templateHref(agreementId)} className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">
              <Download size={20} strokeWidth={1.5} aria-hidden="true" />
              {t("screens.s18plan.import.template")}
            </a>
            <label className="flex min-h-[44px] items-center gap-s-2 text-fs-14 text-k-text">
              {t("screens.s18plan.import.file")}
              <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-fs-14" />
            </label>
            <button
              type="button"
              disabled={!file || importing}
              onClick={() => void runImport()}
              className="flex min-h-[44px] items-center gap-s-2 rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              <Upload size={20} strokeWidth={1.5} aria-hidden="true" />
              {importing ? t("screens.s18detail.saving") : t("buttons.submit")}
            </button>
          </div>
          {result && (
            <div role="status" className="grid gap-s-2">
              <p className="text-fs-16 text-k-ink">{t("screens.s18plan.import.result", { created: result.created, updated: result.updated, skipped: result.skipped })}</p>
              {result.errors.length > 0 && (
                <table className="w-full border-collapse text-fs-14">
                  <caption className="sr-only">{t("screens.s18plan.import.errorsCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="num border-b border-k-grey px-s-2 py-s-1 font-bold text-k-blue-deep">
                        {t("screens.s18plan.import.row")}
                      </th>
                      <th scope="col" className="border-b border-k-grey px-s-2 py-s-1 text-left font-bold text-k-blue-deep">
                        {t("screens.s18plan.import.problem")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e) => (
                      <tr key={`${e.row}-${e.messageEl}`}>
                        <td className="num border-b border-k-grey px-s-2 py-s-1">{e.row}</td>
                        <td className="border-b border-k-grey px-s-2 py-s-1">{e.messageEl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
