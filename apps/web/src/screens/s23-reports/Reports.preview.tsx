// S23, S23a — R39

import { REPORT_CATALOGUE, type ReportKey } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import { buildReport, buildReportCatalogue } from "@/mocks/reports";
import { orgUnits } from "@/mocks/org-units";
import type { PreviewEntry } from "@/preview/types";
import { defaultQuery, catalogueEntry } from "./catalogue";
import { ReportIndex } from "./ReportIndex";
import { ReportPage, type ReportPageProps } from "./ReportPage";

const TODAY = "2026-10-06";

const indexEntry: PreviewEntry = {
  id: "s23-reports",
  title: "S23 Αναφορές",
  states: {
    default: () => <ReportIndex entries={buildReportCatalogue()} state="default" noPermission={<NoPermission />} />,
    loading: () => <ReportIndex state="loading" noPermission={<NoPermission />} />,
    empty: () => <ReportIndex entries={[]} state="empty" noPermission={<NoPermission />} />,
    error: () => <ReportIndex state="error" onRetry={() => undefined} noPermission={<NoPermission />} />,
    noPermission: () => <ReportIndex state="noPermission" noPermission={<NoPermission />} />,
  },
  notes: "Offline does not apply: the index is a list of links, and a cached list is still right.",
};

function page(key: ReportKey, overrides: Partial<ReportPageProps> = {}) {
  const props: ReportPageProps = {
    reportKey: key,
    orgUnits,
    query: defaultQuery(catalogueEntry(key), TODAY),
    onQuery: () => undefined,
    today: TODAY,
    report: buildReport(key),
    state: "default",
    onRetry: () => undefined,
    onExcel: () => undefined,
    onPrint: () => undefined,
    noPermission: <NoPermission backHref="/reports" />,
    ...overrides,
  };
  return <ReportPage {...props} />;
}

/** One gallery entry per report, so each body can be checked in its five states. */
export const reportPagePreviews: PreviewEntry[] = REPORT_CATALOGUE.map(({ key }) => ({
  id: `s23a-${key.toLowerCase().replace(/_/g, "-")}`,
  title: `S23a ${key}`,
  states: {
    default: () => page(key),
    loading: () => page(key, { report: undefined, state: "loading" }),
    empty: () => {
      const report = buildReport(key);
      const emptied = "rows" in report ? { ...report, rows: [] } : { ...report, capital: [], maintenance: [] };
      return page(key, { report: emptied as never });
    },
    error: () => page(key, { report: undefined, state: "error" }),
    noPermission: () => page(key, { state: "noPermission" }),
    offline: () => page(key, { state: "offline" }),
  },
  notes: "The print view is this page under the browser's print preview: the shell, the filters and the buttons drop out, A4 and the orientation come from `printCss`.",
}));

export default indexEntry;
