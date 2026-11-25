// OWNER UAT 25/11/2026 («RFI save: Request to /contracts/<id>/rfis failed with
// 401»). What the browser does when the session has ended under a page that
// is already open: the API token lives eight hours (apps/api ADR-0009), and a
// page left open across that, or across a release, finds out on its next
// request.
//
// Two halves, kept apart so `data/client.ts` stays free of React:
//   - `errorFrom` in `client.ts` turns every 401 into the sentence below and
//     calls `announceSessionExpired()`;
//   - `SessionExpiredDialog` (mounted once, in `QueryProvider`) listens for
//     it and offers the way back to the same page.
//
// The sentences live in `el.json`/`en.json` like every other string; the
// provider hands them to `setErrorTexts` once the messages are loaded. The
// Greek defaults below are what a caller sees before that — a unit test, the
// first render — and a test keeps them equal to `el.json`.

export interface ErrorTexts {
  /** `states.error.sessionExpired` */
  sessionExpired: string;
  /** `states.error.generic` — any refusal that came without a sentence. */
  generic: string;
  /** `states.error.unreachable` — the request never reached eCapital. */
  unreachable: string;
}

export const DEFAULT_ERROR_TEXTS: ErrorTexts = {
  sessionExpired: "Η σύνδεσή σας έληξε. Συνδεθείτε ξανά.",
  generic: "Κάτι πήγε στραβά. Δοκιμάστε ξανά σε λίγο.",
  unreachable: "Το eCapital δεν απαντά αυτή τη στιγμή. Δοκιμάστε ξανά σε λίγο.",
};

let texts: ErrorTexts = DEFAULT_ERROR_TEXTS;

export function setErrorTexts(next: ErrorTexts): void {
  texts = next;
}

export function errorTexts(): ErrorTexts {
  return texts;
}

export const SESSION_EXPIRED_EVENT = "ecapital:session-expired";

/** Tells the open page that its session has ended. A no-op on the server. */
export function announceSessionExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/**
 * Where «Σύνδεση» goes: the sign-in page, told why, and told to come back to
 * `here` (a path with its query) afterwards. The sign-in page only follows a
 * `next` that is a path on this site.
 */
export function signInHrefFor(here: string): string {
  const params = new URLSearchParams({ expired: "1" });
  if (here.startsWith("/") && !here.startsWith("//") && !here.startsWith("/sign-in")) params.set("next", here);
  return `/sign-in?${params.toString()}`;
}
