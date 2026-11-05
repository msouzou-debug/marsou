/**
 * The response headers every page and route of the web app carries
 * (next.config.ts). Clickjacking finding of 05/11/2026 against the estate: a
 * page loaded inside an attacker's frame still carries the viewer's session,
 * so `frame-ancestors 'none'` refuses every frame, and `X-Frame-Options:
 * DENY` says the same to browsers that predate it. eCapital frames nothing
 * of its own — the document preview is an <img> and «Άνοιγμα» is a new tab.
 *
 * The proxy route forwards the API's own Content-Security-Policy for a filed
 * file (the sandbox), which carries the framing rule itself; the API's
 * middleware sets the same four headers on every other answer.
 */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];
