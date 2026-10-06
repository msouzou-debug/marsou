import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { REPORT_CATALOGUE, REPORT_SLUG, type ReportCatalogueEntry, type ReportKey } from "@ecapital/shared";
import { canViewReports } from "@/auth/roles";
import { reportApiPath, reportExportHref } from "@/data/queries";
import { formatEUR } from "@/lib/format";
import { buildReport, buildReportCatalogue, buildStatutoryComplianceReport } from "@/mocks/reports";
import { orgUnits } from "@/mocks/org-units";
import { renderWithIntl } from "@/test/render";
import { doneTint } from "./bodies/StatutoryComplianceBody";
import { catalogueEntry, cssString, defaultQuery, keyFromSlug, printCss, printPageBoxesCss } from "./catalogue";
import { ReportFilterBar } from "./ReportFilterBar";
import { ReportIndex } from "./ReportIndex";
import { ReportPage, type ReportPageProps } from "./ReportPage";

const TODAY = "2026-10-06";
const KEYS = REPORT_CATALOGUE.map((e) => e.key);
/** Testing Library collapses the thin space in «1.234 €» to a plain one. */
const n = (text: string) => text.replace(/\s+/g, " ");

function renderPage<K extends ReportKey>(key: K, overrides: Partial<ReportPageProps<K>> = {}) {
  const props: ReportPageProps<K> = {
    reportKey: key,
    orgUnits,
    query: defaultQuery(catalogueEntry(key), TODAY),
    onQuery: vi.fn(),
    today: TODAY,
    report: buildReport(key),
    state: "default",
    onRetry: vi.fn(),
    onExcel: vi.fn(),
    noPermission: <p>no-permission-marker</p>,
    ...overrides,
  };
  renderWithIntl(<ReportPage {...props} />);
  return props;
}

/** The data rows of the first table, without the header and the totals row. */
function bodyRows(table: HTMLElement) {
  return Array.from(table.querySelectorAll("tbody")[0].querySelectorAll("tr"));
}

afterEach(() => vi.restoreAllMocks());

describe("S23 index", () => {
  it("shows the seven reports as cards in the catalogue's order, whatever order the API sent", () => {
    const shuffled = [...buildReportCatalogue()].reverse();
    renderWithIntl(<ReportIndex entries={shuffled} state="default" noPermission={null} />);
    const list = screen.getByRole("list", { name: "Οι αναφορές" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(7);
    const links = cards.map((c) => within(c).getByRole("link"));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(KEYS.map((k) => `/reports/${REPORT_SLUG[k]}`));
    expect(links[0]).toHaveTextContent("Πρόγραμμα έργων ανά μονάδα");
    expect(links[2]).toHaveTextContent("Αξιολόγηση αναδόχων");
  });

  it("says who each report is for and which filters it takes", () => {
    renderWithIntl(<ReportIndex entries={buildReportCatalogue()} state="default" noPermission={null} />);
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Για: Διοίκηση, Οικονομική Διεύθυνση, Προϊστάμενος Τεχνικών Υπηρεσιών");
    expect(cards[0]).toHaveTextContent("Φίλτρα: μονάδα, έτος");
    expect(cards[2]).toHaveTextContent("Φίλτρα: μονάδα, περίοδος");
    expect(cards[1]).toHaveTextContent("Φίλτρα: μονάδα");
  });

  it("renders noPermission and error", () => {
    renderWithIntl(<ReportIndex state="noPermission" noPermission={<p>no-permission-marker</p>} />);
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });

  it("offers a retry when the catalogue does not load", () => {
    const onRetry = vi.fn();
    renderWithIntl(<ReportIndex state="error" onRetry={onRetry} noPermission={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Δοκιμάστε ξανά" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("S23a report bodies", () => {
  // RULE (contract, ADR-0032 §5): a figure with no source is «—», never 0.
  it.each(KEYS.filter((k) => k !== "CLINICAL_DISRUPTION" && k !== "STATUTORY_COMPLIANCE"))("renders %s from its mock with «—» for nulls", (key) => {
    renderPage(key);
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the clinical disruption months, stacked theatre over ICU, with totals", () => {
    renderPage("CLINICAL_DISRUPTION");
    const table = screen.getByRole("table", { name: "Ώρες χειρουργείων και ΜΕΘ ανά μονάδα και μήνα" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(16);
    const nicosia = bodyRows(table)[0];
    expect(within(nicosia).getByLabelText("Χειρουργεία 3,5")).toBeInTheDocument();
    expect(nicosia).toHaveTextContent("21,5"); // theatre total
    const totals = table.querySelectorAll("tbody")[1];
    expect(totals).toHaveTextContent("Σύνολο");
  });

  it("says «Κανένας έλεγχος» where nothing statutory was due, and colours the share done", () => {
    renderPage("STATUTORY_COMPLIANCE");
    const table = screen.getByRole("table");
    const nicosia = bodyRows(table)[0];
    expect(within(nicosia).getByText("Κανένας έλεγχος")).toBeInTheDocument();
    expect(within(nicosia).getByText("39 από 40")).toBeInTheDocument();
    expect(within(nicosia).getByText("6 εκπρόθεσμοι")).toBeInTheDocument();
    expect(within(nicosia).getByText("1 εκπρόθεσμος")).toBeInTheDocument();
    expect(screen.getByText(/πράσινο από 95 %/)).toBeInTheDocument();
  });

  // ASSUMPTION (UI): green ≥ 95, amber ≥ 80, red below.
  it("tints the share done by the UI thresholds", () => {
    expect(doneTint(95)).toBe("bg-k-green-bg");
    expect(doneTint(94.9)).toBe("bg-k-amber-bg");
    expect(doneTint(80)).toBe("bg-k-amber-bg");
    expect(doneTint(79.9)).toBe("bg-k-red-bg");
  });

  it("totals the capital programme on the client, skipping the units with no ledger", () => {
    renderPage("CAPITAL_PROGRAMME");
    const table = screen.getByRole("table", { name: "Πρόγραμμα έργων ανά μονάδα" });
    const limassol = bodyRows(table).find((r) => r.textContent?.includes("Λεμεσού"))!;
    expect(within(limassol).getAllByText("—").length).toBeGreaterThanOrEqual(4);
    const nicosia = bodyRows(table).find((r) => r.textContent?.includes("Λευκωσίας"))!;
    expect(within(nicosia).getByText(n(`+${formatEUR(200_000)}`))).toHaveClass("text-k-red");
    const totals = table.querySelectorAll("tbody")[1];
    expect(totals).toHaveTextContent("Σύνολο");
    expect(totals).toHaveTextContent(n(formatEUR(6_300_000))); // approved, all three units
    expect(totals).toHaveTextContent(n(formatEUR(3_400_000))); // committed, the two with a source
    expect(totals).toHaveTextContent(n(`+${formatEUR(100_000)}`)); // slippage
    expect(screen.getByText("Έτος που έχει περάσει").parentElement).toHaveTextContent("76,4");
  });

  it("orders the asset lifecycle by remaining life, past life first and unknown last", () => {
    renderPage("ASSET_LIFECYCLE");
    const tags = bodyRows(screen.getByRole("table")).map((r) => within(r).getByRole("link").textContent);
    expect(tags).toEqual(["LAR-LIFT-0002", "NGH-HVAC-0001", "NGH-ELEC-0003"]);
    expect(screen.getByText("-2 έτη")).toHaveClass("text-k-red");
  });

  it("links exceptions to the project and shows the RAG with its word", () => {
    renderPage("EXCEPTIONS");
    expect(screen.getByRole("link", { name: "NGH-2026-004" })).toHaveAttribute("href", "/projects/p-101");
    expect(screen.getByText("Παράβαση")).toBeInTheDocument();
    expect(screen.getByText("21 ημ")).toBeInTheDocument();
  });

  it("shows a maintenance card per agreement with the rates-missing note", () => {
    renderPage("CONTRACTOR_SCORECARD");
    expect(screen.getByRole("heading", { name: "Ανάδοχοι έργων" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Δείγμα Η/Μ Συντήρηση Λτδ · Α.Ο 42/24" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Λείπουν ποσά ρητρών");
  });

  it("tints the backlog bands as S21 and dashes an empty band", () => {
    renderPage("BACKLOG_BY_BAND");
    const table = screen.getByRole("table");
    const nicosia = bodyRows(table)[0];
    const high = within(nicosia).getByText((_, el) => el?.tagName === "SPAN" && el.textContent === `3 εργασίες · ${formatEUR(350_000)}`);
    expect(high).toHaveClass("bg-k-red-bg");
    expect(within(nicosia).getByText("—")).toBeInTheDocument(); // LOW: nothing
  });

  it("says there is no data for the period when a report comes back empty", () => {
    const report = buildStatutoryComplianceReport({ rows: [] });
    renderPage("STATUTORY_COMPLIANCE", { report });
    expect(screen.getByText("Δεν υπάρχουν στοιχεία για την περίοδο.")).toBeInTheDocument();
  });

  it("says there is no data when the contractor scorecard has neither half", () => {
    const report = { ...buildReport("CONTRACTOR_SCORECARD"), capital: [], maintenance: [] };
    renderPage("CONTRACTOR_SCORECARD", { report });
    expect(screen.getByText("Δεν υπάρχουν στοιχεία για την περίοδο.")).toBeInTheDocument();
  });
});

describe("S23a page", () => {
  it("prints the meta line: unit, scope, generated at", () => {
    renderPage("CAPITAL_PROGRAMME");
    expect(screen.getByTestId("report-meta")).toHaveTextContent(/^ΟΚΥπΥ — όλες οι μονάδες · Έτος 2026 · Δημιουργήθηκε 06\/10\/2026/);
  });

  it("states the scorecard's period with the inclusive last day", () => {
    renderPage("CONTRACTOR_SCORECARD");
    expect(screen.getByTestId("report-meta")).toHaveTextContent("01/07/2026 έως 30/09/2026");
  });

  it("calls window.print from «Εκτύπωση / PDF»", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderPage("EXCEPTIONS");
    fireEvent.click(screen.getByRole("button", { name: "Εκτύπωση / PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("downloads the Excel from «Λήψη Excel» and from the table's export button", () => {
    const props = renderPage("EXCEPTIONS");
    fireEvent.click(screen.getByRole("button", { name: "Λήψη Excel" }));
    fireEvent.click(screen.getByRole("button", { name: /Εξαγωγή σε Excel/ }));
    expect(props.onExcel).toHaveBeenCalledTimes(2);
  });

  it("keeps print and Excel off while the report loads", () => {
    renderPage("EXCEPTIONS", { report: undefined, state: "loading" });
    expect(screen.getByRole("button", { name: "Λήψη Excel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Εκτύπωση / PDF" })).toBeDisabled();
  });

  it("renders noPermission", () => {
    renderPage("EXCEPTIONS", { state: "noPermission" });
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });

  it("carries the print stylesheet for the report's orientation", () => {
    renderPage("CLINICAL_DISRUPTION");
    expect(document.querySelector(".report-sheet style")?.textContent).toContain("size: A4 landscape");
  });

  it("adds the running title, meta line and page numbers for the length of a print", () => {
    // The test DOM's CSS parser does not read @page margin boxes and says so on the console.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderPage("STATUTORY_COMPLIANCE");
    const boxes = () => Array.from(document.head.querySelectorAll("style")).filter((el) => el.textContent?.includes("@top-left"));
    expect(boxes()).toHaveLength(0);
    window.dispatchEvent(new Event("beforeprint"));
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].textContent).toContain(cssString("Νομοθετικοί έλεγχοι"));
    window.dispatchEvent(new Event("afterprint"));
    expect(boxes()).toHaveLength(0);
  });
});

describe("S23a filter bar", () => {
  function bar(entry: ReportCatalogueEntry) {
    renderWithIntl(<ReportFilterBar entry={entry} orgUnits={orgUnits} query={defaultQuery(entry, TODAY)} onQuery={vi.fn()} today={TODAY} />);
  }

  it("shows unit and year for the capital programme, no period", () => {
    bar(catalogueEntry("CAPITAL_PROGRAMME"));
    expect(screen.getByRole("combobox", { name: "Μονάδα" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Έτος" })).toHaveValue("2026");
    expect(screen.queryByRole("button", { name: "Τρέχον τρίμηνο" })).not.toBeInTheDocument();
  });

  it("shows unit and the quarter presets for the contractor scorecard, no year", () => {
    bar(catalogueEntry("CONTRACTOR_SCORECARD"));
    expect(screen.queryByRole("combobox", { name: "Έτος" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Προηγούμενο τρίμηνο" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows only the unit for the exceptions, and nothing for a report that takes nothing", () => {
    bar(catalogueEntry("EXCEPTIONS"));
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByLabelText("Από")).not.toBeInTheDocument();
  });

  it("draws no control for an entry with every flag off", () => {
    bar({ key: "EXCEPTIONS", takesUnit: false, takesYear: false, takesPeriod: false, takesAgreement: false });
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("lists «ΟΚΥπΥ — όλες οι μονάδες» first, then the caller's units", () => {
    bar(catalogueEntry("BACKLOG_BY_BAND"));
    const options = within(screen.getByRole("combobox", { name: "Μονάδα" })).getAllByRole("option");
    expect(options[0]).toHaveTextContent("ΟΚΥπΥ — όλες οι μονάδες");
    expect(options).toHaveLength(orgUnits.length + 1);
  });
});

describe("S23 helpers", () => {
  it("maps slugs to keys and back", () => {
    for (const key of KEYS) expect(keyFromSlug(REPORT_SLUG[key])).toBe(key);
    expect(keyFromSlug("nope")).toBeUndefined();
  });

  it("sends only the filters a report takes", () => {
    expect(defaultQuery(catalogueEntry("EXCEPTIONS"), TODAY, "u1")).toEqual({ orgUnitId: "u1" });
    expect(defaultQuery(catalogueEntry("CAPITAL_PROGRAMME"), TODAY)).toEqual({ year: 2026 });
    expect(defaultQuery(catalogueEntry("CONTRACTOR_SCORECARD"), TODAY)).toEqual({ from: "2026-07-01", to: "2026-10-01" });
  });

  it("builds the API path and the proxied xlsx download from one query", () => {
    const q = { orgUnitId: "nicosia-general", year: 2026 };
    expect(reportApiPath("CAPITAL_PROGRAMME", q)).toBe("/reports/capital-programme?orgUnitId=nicosia-general&year=2026");
    expect(reportExportHref("CAPITAL_PROGRAMME", q)).toBe("/api/proxy/reports/capital-programme.xlsx?orgUnitId=nicosia-general&year=2026");
    expect(reportApiPath("EXCEPTIONS", {})).toBe("/reports/exceptions");
  });

  it("escapes a print header so no text can leave its CSS string", () => {
    expect(cssString('a"b\\c</style>')).toBe('"a\\22 b\\5c c\\3c /style\\3e "');
    expect(cssString("Λ")).toBe('"\\39b "');
    const css = printCss("portrait");
    expect(css).toContain("size: A4 portrait");
    expect(css).toContain("break-inside: avoid");
    expect(css).toContain("display: table-header-group");
    const boxes = printPageBoxesCss({ title: "T", meta: "M", page: "P", of: "of" });
    expect(boxes).toContain('@top-left { content: "T"');
    expect(boxes).toContain('@top-right { content: "M"');
    expect(boxes).toContain('"P" " " counter(page) " " "of" " " counter(pages)');
  });

  // RULE (ADR-0032 §6).
  it("gates the reports to estates, finance, executive, auditor and admin", () => {
    for (const role of ["admin", "estates_head", "finance", "executive_readonly", "auditor_readonly"] as const) expect(canViewReports([role])).toBe(true);
    for (const role of ["project_engineer", "technician", "clinical_approver"] as const) expect(canViewReports([role])).toBe(false);
    expect(canViewReports([])).toBe(false);
  });
});
