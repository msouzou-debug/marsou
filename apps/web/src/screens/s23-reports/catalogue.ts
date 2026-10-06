// S23, S23a — R39 (ADR-0032)
//
// Pure helpers over the shared catalogue: slug ↔ key, the default filter a
// report opens with, which way it prints, and the CSS string the print
// view's page margins carry. No React here, so the tests read it directly.
import { REPORT_CATALOGUE, REPORT_SLUG, type ReportCatalogueEntry, type ReportKey, type ReportQuery } from "@ecapital/shared";
import { quarter, type Period } from "@/screens/s22-scorecard/period";

export function keyFromSlug(slug: string): ReportKey | undefined {
  return (Object.keys(REPORT_SLUG) as ReportKey[]).find((key) => REPORT_SLUG[key] === slug);
}

export function catalogueEntry(key: ReportKey): ReportCatalogueEntry {
  // REPORT_CATALOGUE has one entry per key by construction (the shared contract).
  return REPORT_CATALOGUE.find((entry) => entry.key === key)!;
}

/** Order a catalogue the API sent by the shared table's order, whatever order it arrived in. */
export function inCatalogueOrder(entries: ReportCatalogueEntry[]): ReportCatalogueEntry[] {
  const order = REPORT_CATALOGUE.map((e) => e.key);
  return [...entries].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/**
 * The filter a report opens with: the remembered unit (or all of ΟΚΥπΥ),
 * this year, and — for the one report that reads a period, the contractor
 * scorecard — the last full quarter, as S22 does (the maintenance contract
 * pays quarterly, ADR-0031 §9). A filter the report does not take is not
 * sent at all.
 */
export function defaultQuery(entry: ReportCatalogueEntry, today: string, orgUnitId?: string): ReportQuery {
  const query: ReportQuery = {};
  if (entry.takesUnit && orgUnitId) query.orgUnitId = orgUnitId;
  if (entry.takesYear) query.year = Number(today.slice(0, 4));
  if (entry.takesPeriod) {
    const p: Period = quarter(today, -1);
    query.from = p.from;
    query.to = p.to;
  }
  return query;
}

/**
 * RULE (ADR-0032 §3, the S13 print rules): A4, landscape where the table is
 * wide — everything but statutory compliance, whose four categories fit
 * across a portrait page. Clinical disruption has twelve month columns and
 * is landscape by the build brief.
 */
export const PRINT_ORIENTATION: Record<ReportKey, "portrait" | "landscape"> = {
  CAPITAL_PROGRAMME: "landscape",
  EXCEPTIONS: "landscape",
  CONTRACTOR_SCORECARD: "landscape",
  BACKLOG_BY_BAND: "landscape",
  ASSET_LIFECYCLE: "landscape",
  CLINICAL_DISRUPTION: "landscape",
  STATUTORY_COMPLIANCE: "portrait",
};

/**
 * A text as a CSS string literal. Every character outside plain printable
 * ASCII, and the quote, the backslash and the angle brackets, becomes a
 * hex escape — so a unit name can never close the string, or the
 * `<style>` element it sits in.
 */
export function cssString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code > 0x7e || ch === '"' || ch === "\\" || ch === "<" || ch === ">") out += `\\${code.toString(16)} `;
    else out += ch;
  }
  return `${out}"`;
}

/**
 * The print stylesheet of one report, rendered with the page: A4 in the
 * report's orientation, headers repeated through `thead`
 * (table-header-group), no row cut across a page, no zebra or light grey
 * on paper, big type.
 */
export function printCss(orientation: "portrait" | "landscape"): string {
  return `
@page { size: A4 ${orientation}; margin: 18mm 12mm 16mm 12mm; }
@media print {
  html, body { background: var(--k-white); }
  .report-sheet { print-color-adjust: exact; -webkit-print-color-adjust: exact; color: var(--k-ink); font-size: 11pt; }
  .report-sheet h1 { font-size: 20pt; color: var(--k-ink); }
  .report-sheet h2 { font-size: 14pt; color: var(--k-ink); }
  .report-sheet .text-k-text, .report-sheet .text-k-text-muted, .report-sheet .text-k-blue, .report-sheet .text-k-blue-deep { color: var(--k-ink) !important; }
  .report-sheet table { font-size: 11pt; }
  .report-sheet.report-dense table { font-size: 9.5pt; }
  .report-sheet thead { display: table-header-group; position: static !important; }
  .report-sheet tr { background: none !important; break-inside: avoid; page-break-inside: avoid; }
  .report-sheet th, .report-sheet td { border-color: var(--k-ink) !important; }
  .report-sheet .text-fs-12 { font-size: 9pt; }
  .report-sheet a { color: var(--k-ink) !important; text-decoration: none; }
  .report-sheet section, .report-sheet .report-card { break-inside: avoid; }
}`;
}

/**
 * The running header and footer: `@page` margin boxes carry the title and
 * the meta line on every page and «Σελίδα 1 από 3» at the foot (Chromium
 * 131+, i.e. the Chrome and Edge the UAT names; a browser without margin
 * boxes still prints both once, at the top of the first page). Kept apart
 * from `printCss` because the page adds it only around a print
 * (`beforeprint` / `afterprint`): it is print-only by nature, and the test
 * DOM's CSS parser does not read margin boxes.
 */
export function printPageBoxesCss(opts: { title: string; meta: string; page: string; of: string }): string {
  const { title, meta, page, of } = opts;
  const font = "font-family: var(--k-font, sans-serif); color: var(--k-ink, black);";
  return `
@page {
  @top-left { content: ${cssString(title)}; ${font} font-size: 10pt; font-weight: 700; }
  @top-right { content: ${cssString(meta)}; ${font} font-size: 9pt; }
  @bottom-right { content: ${cssString(page)} " " counter(page) " " ${cssString(of)} " " counter(pages); ${font} font-size: 9pt; }
}`;
}
