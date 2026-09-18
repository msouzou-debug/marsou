import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, SESSION_COOKIE } from "@/auth/cookies";

// The gate (R01). Next 16 calls this file `proxy.ts`; it is the former
// `middleware.ts` under its new name, and it runs before any route renders.
//
// RULE: everything except `/sign-in`, `/preview` (the dev-only component
// gallery, ADR-0004) and `/api/*` (the same-origin proxy route, ADR-0005's
// "status" paragraph) needs a session. `/api/proxy/*` checks for the cookie
// itself, with `getSession()`, and answers 401 without it — this file does
// not need to gate it too. This file checks that the cookie is *there*, not
// that it is good: whether the token still verifies is the API's answer to
// give, and asking it here would put a network call in front of every
// request, including the ones for CSS. The `(app)` layout does the real
// check once, with `getSession()`.
//
// RULE: never a redirect loop (UI instructions §6). Two cases, one hop each:
//   - no cookie        -> /sign-in?next=<path>, and /sign-in is outside the gate.
//   - cookie rejected  -> the layout sends the caller to /sign-in?…&stale=1,
//                         and we delete the cookie on the way through, so the
//                         next request is the "no cookie" case, not this one
//                         again.
export const STALE_PARAM = "stale";

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/sign-in" && request.nextUrl.searchParams.has(STALE_PARAM)) {
    const response = NextResponse.next();
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (isPublicPath(pathname)) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything but the build output, the brand assets and the favicon. A
  // matcher that caught those would send the sign-in page's own stylesheet
  // through the gate and leave it unstyled.
  matcher: ["/((?!_next/static|_next/image|brand|favicon.ico).*)"],
};
