// S22 — R37. The contract pays quarterly (ADR-0031 §9), so the scorecard's
// presets are calendar quarters in Nicosia time. `to` is exclusive, as the
// contract's `ScorecardQuery.to` is; the screen shows the inclusive last day.

export interface Period {
  from: string; // ISO date, inclusive
  to: string; // ISO date, exclusive
}

/** Today's date in Europe/Nicosia as `YYYY-MM-DD`. */
export function nicosiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Nicosia", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The calendar quarter holding `today`, moved by `offset` quarters. */
export function quarter(today: string, offset = 0): Period {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)); // 1–12
  const index = Math.floor((month - 1) / 3) + offset + year * 4;
  const y = Math.floor(index / 4);
  const q = index - y * 4;
  const start = new Date(Date.UTC(y, q * 3, 1));
  const end = new Date(Date.UTC(y, q * 3 + 3, 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Exclusive `to` → the inclusive last day a person reads, and back. */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
