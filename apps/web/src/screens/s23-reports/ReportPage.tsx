"use client";

// S23a «Αναφορά» — R39 (CAPEX-01 §11, ADR-0032)
//
/**
 * ReportPage — the one page every report shares, `/reports/<slug>`: title
 * and description, the filter bar from the catalogue flags, the meta line,
 * the report's body, «Λήψη Excel» and «Εκτύπωση / PDF». The same page is
 * the print view: the shell, the filters and the buttons drop out on
 * paper and the stylesheet from `printCss` sets A4, the orientation, the
 * running title, meta line and page numbers.
 *
 * | Prop         | Type                 | Notes                                                         |
 * |--------------|----------------------|---------------------------------------------------------------|
 * | reportKey    | ReportKey            | Which report; its catalogue entry decides the filters.        |
 * | orgUnits     | OrgUnit[]            | The unit select.                                              |
 * | query        | ReportQuery          | What the API is asked; the Excel gets the same.               |
 * | onQuery      | (q) => void          |                                                               |
 * | today        | string               | `YYYY-MM-DD`, Nicosia.                                        |
 * | report       | ReportData[K]?       | Absent while loading.                                         |
 * | state        | ReportPageState      |                                                               |
 * | onExcel      | () => void           | GET /reports/<slug>.xlsx through the proxy.                   |
 * | onPrint      | () => void?          | Defaults to `window.print()`.                                 |
 * | noPermission | ReactNode            |                                                               |
 *
 * RULE (ADR-0032 §1): one query feeds the screen and the workbook, so a
 * figure on the screen is the figure in the file. RULE (ADR-0032 §3): PDF
 * is the browser's print of this page; the API runs no browser.
 */
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileSpreadsheet, Printer } from "lucide-react";
import type { OrgUnit, ReportKey, ReportMeta, ReportQuery } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import type { ReportData } from "@/data/queries";
import { formatDate, formatDateTime } from "@/lib/format";
import { shiftDay } from "@/screens/s22-scorecard/period";
import { AssetLifecycleBody } from "./bodies/AssetLifecycleBody";
import { BacklogByBandBody } from "./bodies/BacklogByBandBody";
import { CapitalProgrammeBody } from "./bodies/CapitalProgrammeBody";
import { ClinicalDisruptionBody } from "./bodies/ClinicalDisruptionBody";
import { ContractorScorecardBody } from "./bodies/ContractorScorecardBody";
import { ExceptionsBody } from "./bodies/ExceptionsBody";
import { StatutoryComplianceBody } from "./bodies/StatutoryComplianceBody";
import type { BodyProps, BodyState } from "./bodies/types";
import { PRINT_ORIENTATION, catalogueEntry, printCss, printPageBoxesCss } from "./catalogue";
import { ReportFilterBar } from "./ReportFilterBar";

export type ReportPageState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface ReportPageProps<K extends ReportKey = ReportKey> {
  reportKey: K;
  orgUnits: OrgUnit[];
  query: ReportQuery;
  onQuery: (next: ReportQuery) => void;
  today: string;
  report?: ReportData[K];
  state: ReportPageState;
  onRetry?: () => void;
  onExcel: () => void;
  exporting?: boolean;
  onPrint?: () => void;
  noPermission: ReactNode;
}

type AnyBody = (props: BodyProps<ReportData[ReportKey]>) => ReactNode;

const BODIES: { [K in ReportKey]: (props: BodyProps<ReportData[K]>) => ReactNode } = {
  CAPITAL_PROGRAMME: CapitalProgrammeBody,
  EXCEPTIONS: ExceptionsBody,
  CONTRACTOR_SCORECARD: ContractorScorecardBody,
  BACKLOG_BY_BAND: BacklogByBandBody,
  ASSET_LIFECYCLE: AssetLifecycleBody,
  CLINICAL_DISRUPTION: ClinicalDisruptionBody,
  STATUTORY_COMPLIANCE: StatutoryComplianceBody,
};

/** The meta line's three parts, from the report's own stamp (ADR-0032 §1: «when and for what»). */
export function useMetaLine(meta: ReportMeta | undefined): string {
  const t = useTranslations();
  if (!meta) return "";
  const unit = meta.orgUnitName ?? t("common.allOkypy");
  const scope =
    meta.from && meta.to
      ? t("screens.s23a.meta.period", { from: formatDate(meta.from), to: formatDate(shiftDay(meta.to.slice(0, 10), -1)) })
      : meta.year !== null
        ? t("screens.s23a.meta.year", { year: String(meta.year) })
        : t("screens.s23a.meta.current");
  return t("screens.s23a.meta.line", { unit, scope, generatedAt: formatDateTime(meta.generatedAt) });
}

/**
 * Adds the running header and footer (`printPageBoxesCss`) for the length
 * of a print — the button's and the browser's own Ctrl+P alike — and takes
 * it away after.
 */
function usePrintPageBoxes(css: string): void {
  useEffect(() => {
    let style: HTMLStyleElement | null = null;
    const add = () => {
      style ??= document.head.appendChild(document.createElement("style"));
      style.textContent = css;
    };
    const remove = () => {
      style?.remove();
      style = null;
    };
    window.addEventListener("beforeprint", add);
    window.addEventListener("afterprint", remove);
    return () => {
      window.removeEventListener("beforeprint", add);
      window.removeEventListener("afterprint", remove);
      remove();
    };
  }, [css]);
}

export function ReportPage<K extends ReportKey>(props: ReportPageProps<K>) {
  const { reportKey, orgUnits, query, onQuery, today, report, state, onRetry, onExcel, exporting, noPermission } = props;
  const t = useTranslations();
  const metaLine = useMetaLine(report?.meta);
  const reportTitle = t(`reportKey.${reportKey as ReportKey}`);
  usePrintPageBoxes(printPageBoxesCss({ title: reportTitle, meta: metaLine, page: t("screens.s23a.print.page"), of: t("screens.s23a.print.of") }));

  if (state === "noPermission") return <>{noPermission}</>;

  const key: ReportKey = reportKey;
  const entry = catalogueEntry(key);
  const title = reportTitle;
  const Body = BODIES[reportKey] as unknown as AnyBody;
  const bodyState: BodyState = state;
  const onPrint = props.onPrint ?? (() => window.print());
  const canPrint = state === "default" || state === "offline";
  const buttonClass =
    "flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey bg-k-white px-s-3 py-s-2 text-fs-14 text-k-blue-deep disabled:opacity-50";

  return (
    <div className={`report-sheet ${reportKey === "CLINICAL_DISRUPTION" || reportKey === "ASSET_LIFECYCLE" ? "report-dense" : ""}`}>
      <style>{printCss(PRINT_ORIENTATION[key])}</style>
      <PageTitle
        eyebrow={
          <Link href="/reports" className="hover:underline">
            {t("nav.reports")}
          </Link>
        }
        title={title}
        action={
          <div className="flex flex-wrap gap-s-2 print:hidden">
            <button type="button" onClick={onExcel} disabled={state === "loading" || state === "offline" || exporting} className={buttonClass}>
              <FileSpreadsheet size={24} strokeWidth={1.5} aria-hidden="true" />
              {t("buttons.downloadExcel")}
            </button>
            <button type="button" onClick={onPrint} disabled={!canPrint} className={buttonClass}>
              <Printer size={24} strokeWidth={1.5} aria-hidden="true" />
              {t("buttons.printPdf")}
            </button>
          </div>
        }
      />
      <p className="mb-s-5 max-w-[760px] text-fs-16 text-k-text print:hidden">{t(`screens.s23a.reports.${key}.description`)}</p>

      <ReportFilterBar entry={entry} orgUnits={orgUnits} query={query} onQuery={onQuery} today={today} />

      {exporting && (
        <p role="status" className="mb-s-3 text-fs-14 text-k-text print:hidden">
          {t("screens.s23a.exporting")}
        </p>
      )}
      {state === "offline" && <p className="mb-s-3 text-fs-14 text-k-text print:hidden">{t("states.offline.readOnly")}</p>}
      {metaLine && (
        <p data-testid="report-meta" className="mb-s-5 text-fs-16 text-k-ink">
          {metaLine}
        </p>
      )}

      <Body report={report} state={bodyState} onExport={onExcel} onRetry={onRetry} />
    </div>
  );
}
