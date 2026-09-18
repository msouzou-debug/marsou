import type { ZodType } from "zod";

// Two fetchers, because two different things call the API.
//
// `apiFetch` is `serverApi()`'s fetcher (see `src/data/server.ts`): absolute
// base URL, a bearer token, and the error body shape from the API's
// exception filter. Every server-side caller — the session, the org-unit
// screens — goes through here directly.
//
// `proxyFetch` is what the browser calls. The bearer token lives in an
// httpOnly cookie (ADR-0013) and never reaches client JavaScript, so S01–S03's
// TanStack Query hooks (`src/data/queries.ts`) cannot call `apiFetch`
// themselves — they call the same-origin `/api/proxy/*` route instead
// (`src/app/api/proxy/[...path]/route.ts`), which reads that cookie on the
// server and forwards the request to the real API with the bearer attached.
// M0's mock route handlers under `src/app/api/{portfolio,projects}` (ADR-0005)
// are gone; this proxy is the M1 replacement, not a third data source.
//
// R15: the data source is swapped by changing `NEXT_PUBLIC_API_BASE`, not by
// changing a caller. `apps/web/.env.example` documents the variable.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The API's i18n key (`errors.*`) when it sent one. */
    readonly key?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiFetchOptions {
  /** Bearer token. Server callers get it from `serverApi()`; nothing in the
   *  browser ever holds one (ADR-0013). */
  token?: string;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

async function errorFrom(res: Response, path: string): Promise<ApiError> {
  let key: string | undefined;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && typeof (body as { key?: unknown }).key === "string") {
      key = (body as { key: string }).key;
    }
  } catch {
    // A non-JSON body (a proxy page, an empty 502) is still an error; the
    // status is what callers branch on.
  }
  return new ApiError(`Request to ${path} failed with ${res.status}`, res.status, key);
}

/** The NestJS API. `path` starts with a slash and carries no `/api` prefix. */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T>,
  options: ApiFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    // Never cached: every response is scoped to the caller's units by the
    // row policies (ADR-0010), so a shared cache entry would be a leak.
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res, path);
  return schema.parse(await res.json());
}

/**
 * The same-origin proxy (`src/app/api/proxy/[...path]/route.ts`). `path`
 * starts with a slash and carries no `/api/proxy` prefix, the same shape
 * `apiFetch`'s `path` has — a caller can be pointed at either fetcher without
 * changing the path it passes.
 */
export async function proxyFetch<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, { cache: "no-store" });
  if (!res.ok) throw await errorFrom(res, path);
  return schema.parse(await res.json());
}
