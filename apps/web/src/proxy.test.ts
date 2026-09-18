import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/auth/cookies";
import { proxy } from "./proxy";

function request(path: string, cookie?: string): NextRequest {
  const req = new NextRequest(new URL(path, "http://localhost:3000"));
  if (cookie !== undefined) req.cookies.set(SESSION_COOKIE, cookie);
  return req;
}

describe("proxy", () => {
  it("sends a signed-out visitor to sign-in and remembers where they were going", () => {
    const response = proxy(request("/units/nicosia-general/areas?tab=floors"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/units/nicosia-general/areas?tab=floors");
  });

  it("lets a request with a session cookie through without asking the API", () => {
    const response = proxy(request("/", "a-token"));
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["/sign-in", "/preview", "/preview/app-shell", "/api/proxy/portfolio"])(
    "leaves %s open",
    (path) => {
      expect(proxy(request(path)).headers.get("location")).toBeNull();
    },
  );

  // RULE: never a redirect loop (UI instructions §6). The layout sends a
  // rejected cookie back here with ?stale=1; the cookie is deleted on the way
  // through, the sign-in page renders, and the next request is an ordinary
  // signed-out one.
  it("clears a rejected cookie once and renders sign-in rather than redirecting again", () => {
    const response = proxy(request("/sign-in?next=/&stale=1", "an-expired-token"));
    expect(response.headers.get("location")).toBeNull();
    // A delete goes out as the cookie set to an empty value with an expiry
    // in the past, which is what the browser needs to drop it.
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("does not bounce a signed-out visitor who is already on sign-in", () => {
    expect(proxy(request("/sign-in?next=/units/x/areas")).headers.get("location")).toBeNull();
  });
});
