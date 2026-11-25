import type { ZodType } from "zod";
import { announceSessionExpired, errorTexts } from "./session-expiry";

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

/**
 * Reads the API's error body — `{key, message, requestId}` (the NestJS
 * `HttpExceptionFilter`) — and turns it into an `ApiError`. `message` is
 * already a sentence in the caller's language (`Accept-Language`), so a form
 * that catches an `ApiError` can show `.message` straight to the user rather
 * than re-translating `.key` itself.
 */
async function errorFrom(res: Response): Promise<ApiError> {
  let key: string | undefined;
  let message: string | undefined;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const candidate = body as { key?: unknown; message?: unknown };
      if (typeof candidate.key === "string") key = candidate.key;
      if (typeof candidate.message === "string" && candidate.message.trim()) message = candidate.message;
    }
  } catch {
    // A non-JSON body (a proxy page, an empty 502) is still an error; the
    // status is what callers branch on.
  }
  // OWNER UAT 25/11/2026: a 401 is the session having ended, wherever it
  // came from — the proxy finding no cookie, or the API refusing a token
  // that ran out. Every caller shows the same sentence, and the open page is
  // told so it can offer the way back (`SessionExpiredDialog`). A deactivated
  // account keeps the API's own sentence.
  if (res.status === 401) {
    announceSessionExpired();
    const own = key && key !== "errors.notSignedIn" ? message : undefined;
    return new ApiError(own ?? errorTexts().sessionExpired, 401, key ?? "errors.notSignedIn");
  }
  // RULE (owner UAT 25/11/2026): never an English «Request to … failed with
  // …» in front of a user. A refusal without a sentence of its own (a proxy's
  // HTML error page, a bare 502) gets the generic one.
  return new ApiError(message ?? errorTexts().generic, res.status, key);
}

/**
 * `fetch`, with a failure to reach the server at all (the network, or the
 * web server restarting for a release) said in a sentence instead of the
 * browser's own «Failed to fetch». An abort stays an abort.
 */
async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (init.signal?.aborted) throw error;
    throw new ApiError(errorTexts().unreachable, 0, "errors.apiUnreachable");
  }
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
  if (!res.ok) throw await errorFrom(res);
  return schema.parse(await res.json());
}

/**
 * The same-origin proxy (`src/app/api/proxy/[...path]/route.ts`). `path`
 * starts with a slash and carries no `/api/proxy` prefix, the same shape
 * `apiFetch`'s `path` has — a caller can be pointed at either fetcher without
 * changing the path it passes.
 */
export async function proxyFetch<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await send(`/api/proxy${path}`, { cache: "no-store" });
  if (!res.ok) throw await errorFrom(res);
  return schema.parse(await res.json());
}

export type ApiMutateMethod = "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiMutateOptions {
  signal?: AbortSignal;
}

/**
 * The proxy's write side (`src/app/api/proxy/[...path]/route.ts`). Every
 * write form (S02a create/edit, the S03 phase-change dialog) goes through
 * here — never `apiFetch` directly, for the same reason `proxyFetch` exists:
 * the browser never holds the bearer token (ADR-0013).
 *
 * Throws `ApiError` on a non-2xx response, with `.status`, `.key` and
 * `.message` from the API's own error body — `.message` is already a
 * sentence in the caller's language, so a form's error strip or field error
 * can show it directly instead of re-translating `.key`.
 */
export async function apiMutate<T>(
  path: string,
  method: ApiMutateMethod,
  body: unknown,
  schema: ZodType<T>,
  options: ApiMutateOptions = {},
): Promise<T> {
  const res = await send(`/api/proxy${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res);
  const text = await res.text();
  return schema.parse(text ? JSON.parse(text) : undefined);
}

/** `filename*=UTF-8''…` first (a Greek title), then `filename="…"`, then the fallback. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      /* a malformed escape: try the plain name */
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(disposition);
  return plain?.[1] ?? fallback;
}

/**
 * A POST that answers with a file — the generic table export
 * (`POST /exports/table`, UAT 25/11/2026). The GET exports (S04, S09a, S21,
 * the reports) are a plain navigation the browser downloads by itself; a
 * POST cannot be, because its body is the rows, so this reads the bytes and
 * hands them to the browser through a temporary link. The file name is the
 * API's own `Content-Disposition`.
 *
 * Throws `ApiError` on a non-2xx response, like `apiMutate`.
 */
export async function apiDownload(path: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await send(`/api/proxy${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileNameFrom(res.headers.get("content-disposition"), fallbackName);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // After the click has handed the bytes to the browser's download.
    window.setTimeout(() => {
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    }, 1_000);
  }
}

/**
 * S10's `POST /cost/imports`: the one write in this app whose body is not
 * JSON. Never set a `content-type` header by hand here — the browser adds
 * `multipart/form-data; boundary=…` itself when the body is a `FormData`,
 * and the proxy route forwards whatever content-type it receives untouched
 * (`src/app/api/proxy/[...path]/route.ts`).
 */
export async function apiMutateMultipart<T>(
  path: string,
  form: FormData,
  schema: ZodType<T>,
  options: ApiMutateOptions = {},
): Promise<T> {
  const res = await send(`/api/proxy${path}`, {
    method: "POST",
    body: form,
    signal: options.signal,
    cache: "no-store",
  });
  if (!res.ok) throw await errorFrom(res);
  const text = await res.text();
  return schema.parse(text ? JSON.parse(text) : undefined);
}
