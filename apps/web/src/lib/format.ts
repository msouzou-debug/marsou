// Number, date and duration formatting per UI instructions §1 "Money".
// Both languages use the same numeric conventions (Greek separators, DD/MM/YYYY).
//
// Owner decision 19/09/2026 (docs/briefs/README.md Errata): money renders the
// way eFinance does, `1.234,56 €` — number first, thin space, euro sign after
// — replacing the previous `€ 1.234,56`. Rounding rules are unchanged.

const THIN = " "; // narrow no-break space: reads as a thin space, never breaks a line
const NBSP = " ";

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * 1.234.567 €   ≥ 1.000: no decimals, dot thousands separator, thin space before €
 * 845,20 €      < 1.000: two decimals, comma decimal
 * -12.400 €     negative: leading minus in front of the number. Never brackets. Caller colours it --k-red.
 */
export function formatEUR(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const neg = value < 0;
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1000) {
    body = groupThousands(Math.round(abs).toString());
  } else {
    const [int, dec] = abs.toFixed(2).split(".");
    body = `${int},${dec}`;
  }
  return `${neg ? "-" : ""}${body}${THIN}€`;
}

/**
 * `formatEUR`, but a ledger the system does not know yet (CAPEX-01 §7) is
 * `null`, never zero — this renders «—» for it instead of «0 €». Shared by
 * every screen that shows a nullable ledger figure (S01's KPI tiles and unit
 * table, S02's Δεσμεύσεις/Δαπάνες columns, S03's CostBar legend).
 */
export function formatEURorDash(value: number | null): string {
  return value === null ? "—" : formatEUR(value);
}

/** 12,4 % — one decimal, comma, thin space before the sign. */
export function formatPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(decimals).replace(".", ",");
  return `${fixed}${THIN}%`;
}

/** 14/03/2026 in both languages, Europe/Nicosia. */
export function formatDate(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("el-GR", {
    timeZone: "Europe/Nicosia",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function formatTimeOnly(d: Date): string {
  return new Intl.DateTimeFormat("el-GR", {
    timeZone: "Europe/Nicosia",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** 14/03/2026 10:42 */
export function formatDateTime(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)}${NBSP}${formatTimeOnly(d)}`;
}

/**
 * A permit window (PermitBanner, S13's print sheet, S12's facts): both ends
 * are hours, not just a date, so a window is never rendered as two bare
 * dates. `dd/mm/yyyy HH:mm – HH:mm` when both ends fall on the same day in
 * Europe/Nicosia; otherwise the full `formatDateTime` on both ends, because
 * a window spanning midnight needs both dates to read unambiguously.
 */
export function formatDateTimeRange(from: Date | string | number, to: Date | string | number): string {
  const start = from instanceof Date ? from : new Date(from);
  const end = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  if (formatDate(start) === formatDate(end)) {
    return `${formatDate(start)}${NBSP}${formatTimeOnly(start)} – ${formatTimeOnly(end)}`;
  }
  return `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/** 3 ημ / 3 d — the unit label comes from i18n; this only formats the number. */
export function formatDays(days: number, unitLabel: string): string {
  return `${Math.round(days)}${NBSP}${unitLabel}`;
}

/** Plain integer with Greek thousands separator: 1.234 */
export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const neg = value < 0;
  return `${neg ? "-" : ""}${groupThousands(Math.round(Math.abs(value)).toString())}`;
}

/**
 * Hours and other measured figures: Greek thousands separator, up to one
 * decimal, comma, no trailing «,0» — `1.234,5`, `12`, `0,5`. M6's clinical
 * disruption and asset downtime hours, which the API sends unrounded and
 * the Excel keeps, so the screen must not round 3,5 h to 4.
 */
export function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const neg = value < 0;
  const [int, dec] = (Math.round(Math.abs(value) * 10) / 10).toFixed(1).split(".");
  const body = dec === "0" ? groupThousands(int) : `${groupThousands(int)},${dec}`;
  return `${neg && body !== "0" ? "-" : ""}${body}`;
}

/** File size for the S26 guides table (R50): 1,2 MB / 340 KB / 512 B. One
 *  decimal above 1 KB, comma, thin space before the unit — same convention
 *  as `formatPct`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)}${THIN}B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fixed = value.toFixed(value < 10 ? 1 : 0).replace(".", ",");
  return `${fixed}${THIN}${units[unitIndex]}`;
}

/**
 * A contract's system name as the list columns show it. The Nicosia
 * catalogue names a system with the whole clause of the contract table —
 * «Συστήματα Παροχής Κρύου/Ζεστού νερού και πόσιμου νερού, συμπεριλαμβανομένων
 * και όλων των συστημάτων…» — which is right on the catalogue and ten lines
 * tall on a work-order row. The list keeps the part before the first comma,
 * and before the first parenthesis when that is still long; the code next to
 * it says which line of the table it is. Nothing is cut mid-word and no
 * ellipsis is shown (UI brief §4.1).
 */
export function shortSystemName(name: string | null | undefined): string {
  if (!name) return "";
  let short = name.split(",")[0].trim();
  if (short.length > 60) short = short.split(" (")[0].trim();
  return short;
}
