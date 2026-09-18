// Number, date and duration formatting per UI instructions §1 "Money".
// Both languages use the same numeric conventions (Greek separators, DD/MM/YYYY).

const THIN = " "; // narrow no-break space: reads as a thin space, never breaks a line
const NBSP = " ";

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * € 1.234.567   ≥ €1.000: no decimals, dot thousands separator, thin space after €
 * € 845,20      < €1.000: two decimals, comma decimal
 * -€ 12.400     negative: leading minus. Never brackets. Caller colours it --k-red.
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
  return `${neg ? "-" : ""}€${THIN}${body}`;
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

/** 14/03/2026 10:42 */
export function formatDateTime(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const date = formatDate(d);
  const time = new Intl.DateTimeFormat("el-GR", {
    timeZone: "Europe/Nicosia",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date}${NBSP}${time}`;
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
