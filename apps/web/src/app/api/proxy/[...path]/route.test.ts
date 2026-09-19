import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Me } from "@ecapital/shared";

vi.mock("@/auth/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/auth/session";
import { GET, POST } from "./route";

// RouteContext<"/api/proxy/[...path]"> is a Next-generated type; a plain
// object with the same shape (an async `params`) is all a handler reads.
function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(getSession).mockReset();
});

// R04/R05 write flows go through this route (S02a create/edit, S03's phase
// change); the Origin check is the second lock behind the sameSite=lax
// session cookie (ADR-0013).
describe("proxy route — Origin check on a mutating request", () => {
  it("refuses a POST whose Origin is not this app's own, without even reading the session", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/projects"), {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({}),
    });

    const res = await POST(req, context(["projects"]));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ key: "errors.originNotAllowed" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("refuses a POST with no Origin header at all", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/projects"), { method: "POST" });
    const res = await POST(req, context(["projects"]));
    expect(res.status).toBe(403);
  });

  it("does not apply the Origin check to a GET", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/projects"), {
      method: "GET",
      headers: { origin: "https://evil.example" },
    });
    const res = await GET(req, context(["projects"]));
    // Falls through past the (skipped) Origin check to the session check.
    expect(res.status).toBe(401);
  });
});

describe("proxy route — session check", () => {
  it("answers 401 with errors.notSignedIn when there is no session, same-origin or not", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/projects"), {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: "{}",
    });
    const res = await POST(req, context(["projects"]));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ key: "errors.notSignedIn" });
  });
});

describe("proxy route — forwarding a same-origin mutation", () => {
  it("forwards the bearer, the locale cookie as Accept-Language, and the body, and passes the upstream status through", async () => {
    vi.mocked(getSession).mockResolvedValue({ token: "tok-1", me: {} as Me });
    const upstream = new Response(JSON.stringify({ id: "PRJ-1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/projects"), {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ titleEl: "Νέο έργο" }),
    });
    req.cookies.set("ecapital_locale", "en");

    const res = await POST(req, context(["projects"]));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "PRJ-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/projects");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect((init.headers as Record<string, string>)["accept-language"]).toBe("en");
    expect(init.body).toBe(JSON.stringify({ titleEl: "Νέο έργο" }));
  });

  it("defaults Accept-Language to el when there is no locale cookie", async () => {
    vi.mocked(getSession).mockResolvedValue({ token: "tok-1", me: {} as Me });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/projects/p-1/phase"), {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({ phase: "APPROVED", reasonEl: "x" }),
    });

    await POST(req, context(["projects", "p-1", "phase"]));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["accept-language"]).toBe("el");
  });
});
