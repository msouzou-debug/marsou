import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/auth/session";
import { API_BASE } from "@/data/client";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "@/i18n/config";

// M1's same-origin proxy (see ADR-0005's "status" paragraph for why the
// ADR-0005 mock route handlers are gone). The bearer token lives in an
// httpOnly cookie and never reaches client JavaScript (ADR-0013), so the
// browser cannot call `apps/api` itself the way `serverApi()` does. Instead
// `proxyFetch`/`apiMutate` (`src/data/client.ts`), which every screen's
// TanStack Query hooks and write forms call, hit this route; this route
// reads the session cookie on the server, via the same `getSession()` every
// Server Component uses, and forwards the request to the real API with the
// bearer attached.
//
// GET, POST, PATCH, PUT and DELETE all forward the same way. What changes
// for a mutating verb:
//   - the Origin check below runs first, before the session is even read;
//   - the body is read and forwarded as-is (the API does its own zod
//     validation; this route is not a second place that decides what a
//     valid body looks like);
//   - `Accept-Language` is set from the locale cookie (ADR-0002), not
//     forwarded from the browser's own header, so the API's error sentence
//     (`errors.*`, `{key, message, requestId}`) comes back in the language
//     the app is actually showing, not whatever the browser's OS locale is.
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

type ProxyContext = RouteContext<"/api/proxy/[...path]">;

async function forward(request: NextRequest, context: ProxyContext, method: string): Promise<NextResponse> {
  // RULE: the session cookie is sameSite=lax (ADR-0013), which already keeps
  // it off genuine cross-site requests. This is the second lock: a mutating
  // request whose Origin does not match this app's own origin is refused
  // outright, before the cookie is even read — lax still allows some
  // same-site-but-not-same-origin and top-level-navigation edge cases, and a
  // non-browser client can omit the header or spoof it, so a browser
  // request that is genuinely same-origin always carries a matching Origin
  // for POST/PATCH/PUT/DELETE (browsers have sent it unconditionally for
  // these methods since well before this app existed) — anything else is
  // refused rather than trusted.
  if (MUTATING_METHODS.has(method)) {
    const origin = request.headers.get("origin");
    if (origin !== request.nextUrl.origin) {
      return NextResponse.json({ key: "errors.originNotAllowed" }, { status: 403 });
    }
  }

  const session = await getSession();
  if (!session) {
    // The same body shape `AppError.unauthorized()` sends for a request with
    // no token, so a caller branching on `ApiError.status`/`.key` (see
    // `data/client.ts`) cannot tell this apart from the API refusing it
    // directly.
    return NextResponse.json({ key: "errors.notSignedIn" }, { status: 401 });
  }

  const { path } = await context.params;
  const localeCookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(localeCookie) ? localeCookie : defaultLocale;

  const headers: Record<string, string> = {
    authorization: `Bearer ${session.token}`,
    "accept-language": locale,
  };

  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const text = await request.text();
    if (text) {
      body = text;
      headers["content-type"] = request.headers.get("content-type") ?? "application/json";
    }
  }

  const upstream = await fetch(`${API_BASE}/${path.join("/")}${request.nextUrl.search}`, {
    method,
    headers,
    body,
    // Never cached: every response is scoped to the caller's units by the
    // row policies (ADR-0010), so a shared cache entry would be a leak.
    cache: "no-store",
  });

  const responseBody = await upstream.text();
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export function GET(request: NextRequest, context: ProxyContext): Promise<NextResponse> {
  return forward(request, context, "GET");
}

export function POST(request: NextRequest, context: ProxyContext): Promise<NextResponse> {
  return forward(request, context, "POST");
}

export function PATCH(request: NextRequest, context: ProxyContext): Promise<NextResponse> {
  return forward(request, context, "PATCH");
}

export function PUT(request: NextRequest, context: ProxyContext): Promise<NextResponse> {
  return forward(request, context, "PUT");
}

export function DELETE(request: NextRequest, context: ProxyContext): Promise<NextResponse> {
  return forward(request, context, "DELETE");
}
