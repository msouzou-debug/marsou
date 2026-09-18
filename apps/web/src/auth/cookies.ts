// Cookie names shared by the session helpers, the server actions and the
// gate in `src/proxy.ts`. Kept in a module of its own, with no imports, so
// the proxy can read a name without pulling `next/headers` or `react` into
// the proxy bundle.

/** Holds the API bearer token. httpOnly — never readable from the browser. */
export const SESSION_COOKIE = "ecapital_session";

/** The org unit the switcher is on. Not a permission: the API decides. */
export const UNIT_COOKIE = "ecapital_unit";

/** Routes that are reachable without a session (see `src/proxy.ts`). */
export const PUBLIC_PATHS = ["/sign-in", "/preview", "/api"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
