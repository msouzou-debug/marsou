import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/auth/session";
import { API_BASE } from "@/data/client";

// M1's replacement for the ADR-0005 mock route handlers (see ADR-0005's
// "status" paragraph): a same-origin GET proxy. The bearer token lives in an
// httpOnly cookie and never reaches client JavaScript (ADR-0013), so the
// browser cannot call `apps/api` itself the way `serverApi()` does. Instead
// `proxyFetch` (`src/data/client.ts`), which S01–S03's TanStack Query hooks
// call, hits this route; this route reads the session cookie on the server,
// via the same `getSession()` every Server Component uses, and forwards the
// request to the real API with the bearer attached.
//
// GET only, on purpose: nothing behind these three screens writes yet, and a
// proxy that also forwarded POST/PATCH/DELETE would be a second place — this
// route, instead of the API's own CORS and auth checks — where a mistake
// could widen what the browser may do.
export async function GET(request: NextRequest, context: RouteContext<"/api/proxy/[...path]">) {
  const session = await getSession();
  if (!session) {
    // The same body shape `AppError.unauthorized()` sends for a request with
    // no token, so a caller branching on `ApiError.status`/`.key` (see
    // `data/client.ts`) cannot tell this apart from the API refusing it
    // directly.
    return NextResponse.json({ key: "errors.notSignedIn" }, { status: 401 });
  }

  const { path } = await context.params;
  const upstream = await fetch(`${API_BASE}/${path.join("/")}${request.nextUrl.search}`, {
    headers: { authorization: `Bearer ${session.token}` },
    // Never cached: every response is scoped to the caller's units by the
    // row policies (ADR-0010), so a shared cache entry would be a leak.
    cache: "no-store",
  });

  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
