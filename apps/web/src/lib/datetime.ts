// S11a step 3 (R19) — converting a `datetime-local` input value to and from
// the ISO instant the API stores.
//
// A `datetime-local` value such as "2026-04-01T08:00" carries no offset. Per
// spec, `new Date(value)` on an unqualified date-time string is parsed as the
// runtime's own local time — the browser's, for anything running in one —
// and `.toISOString()` on the result is therefore that wall-clock moment
// converted to UTC with the browser's own offset. That is correct for a
// person filling in the wizard in their own timezone, and it is what
// `localInputToIsoInstant` does explicitly rather than leaving it implicit at
// the call site, so `draftToBody`'s PATCH autosave and the wizard's own
// review step share the exact same conversion (task item, S11a).
//
// The reverse direction has to use the runtime's local getters
// (`getFullYear`, `getHours`, …), never a slice of the ISO string: an ISO
// instant is UTC, and truncating it to sixteen characters puts the UTC
// wall-clock time into a field the browser treats as its own local time —
// which is exactly the bug the 19/09/2026 screenshot showed (a permit window
// entered as 08:00–16:00 and stored, then re-read as if 08:00 UTC were
// already local, and shifted again on display).
//
// Both read the runtime's own offset, so both agree only when the runtime's
// timezone is the person's real one — true for a Cypriot user's own browser,
// which is why `apps/web/e2e/playwright.config.ts` pins `timezoneId:
// "Europe/Nicosia"` for the projects that exercise this screen: without it, a
// CI sandbox in another zone would convert correctly but never round-trip
// back to the same wall-clock time the display (fixed to Europe/Nicosia,
// `formatDateTime`) shows.

/** A `datetime-local` input value ("YYYY-MM-DDTHH:mm") to an ISO instant, using the runtime's own offset. */
export function localInputToIsoInstant(value: string): string {
  return new Date(value).toISOString();
}

/** An ISO instant back to a `datetime-local` value, in the runtime's own local time. */
export function isoInstantToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
