// Cookie names shared by the session helpers, the server actions and the
// gate in `src/proxy.ts`. Kept in a module of its own, with no imports, so
// the proxy can read a name without pulling `next/headers` or `react` into
// the proxy bundle.

/** Holds the API bearer token. httpOnly — never readable from the browser. */
export const SESSION_COOKIE = "ecapital_session";

/** The org unit the switcher is on. Not a permission: the API decides. */
export const UNIT_COOKIE = "ecapital_unit";

/**
 * ADR-0018 §5 — whether the session cookie carries `Secure`.
 *
 * On the ΟΚΥπΥ server the answer is not "is this production": the Next
 * process speaks plain HTTP, because TLS is terminated on a separate
 * cloudflared box in front of it. What decides it is the origin the browser
 * used, which is what `NEXT_PUBLIC_APP_ORIGIN` holds — `https://capital.shso.online`
 * there, `http://localhost:3000` on a developer's machine.
 *
 * Getting it wrong either way is a real failure: `Secure` on a plain-HTTP
 * developer origin means the cookie is silently never stored and nobody can
 * sign in, and no `Secure` behind cloudflared means the cookie would go out
 * over any plain-HTTP request that reached the same host.
 */
export function sessionCookieIsSecure(
  origin: string | undefined = process.env.NEXT_PUBLIC_APP_ORIGIN,
): boolean {
  return (origin ?? "").trim().toLowerCase().startsWith("https://");
}

/** Routes that are reachable without a session (see `src/proxy.ts`). */
export const PUBLIC_PATHS = ["/sign-in", "/preview", "/api"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
