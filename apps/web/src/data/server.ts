import { cache } from "react";
import { z, type ZodType } from "zod";
import { OrgUnit } from "@ecapital/shared";
import { getSession } from "@/auth/session";
import { apiFetch, type ApiFetchOptions } from "./client";

// Server Components read the API through here: one call gets the session and
// a fetcher that already carries the bearer, so no page has to remember to
// attach it. Returns null when nobody is signed in — the caller redirects
// (the `(app)` layout does it once for every screen underneath it).
//
// Client components do not get an equivalent, by design: the token is in an
// httpOnly cookie and never crosses into the browser (ADR-0013).

export interface ServerApi {
  token: string;
  get<T>(path: string, schema: ZodType<T>, options?: Omit<ApiFetchOptions, "token">): Promise<T>;
}

export async function serverApi(): Promise<ServerApi | null> {
  const session = await getSession();
  if (!session) return null;
  return {
    token: session.token,
    get: (path, schema, options) => apiFetch(path, schema, { ...options, token: session.token }),
  };
}

/**
 * The caller's own org units (R01). Cached per request: the shell's switcher
 * and whatever screen is underneath it both want the list, and they should
 * cost one call between them.
 *
 * An unreachable API gives an empty list rather than a thrown error. The
 * shell renders around every screen, so a failure here would blank the whole
 * app; an empty switcher plus the screen's own error state says the same
 * thing without taking the page down with it.
 */
export const getVisibleOrgUnits = cache(async (): Promise<OrgUnit[]> => {
  const api = await serverApi();
  if (!api) return [];
  try {
    return await api.get("/org-units", z.array(OrgUnit));
  } catch {
    return [];
  }
});
