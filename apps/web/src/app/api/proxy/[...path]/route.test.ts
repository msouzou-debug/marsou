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

// M2 (R14) — S10's `POST /cost/imports` multipart upload.
describe("proxy route — multipart passthrough (S10 SAP import)", () => {
  it("forwards a multipart body as a stream, untouched, with its original content-type", async () => {
    vi.mocked(getSession).mockResolvedValue({ token: "tok-1", me: {} as Me });
    const upstream = new Response(JSON.stringify({ id: "batch-1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.set("report", "ME2N");
    form.set("period", "2026-09");
    form.set("dryRun", "true");
    form.set("file", new File(["a,b,c"], "me2n.csv", { type: "text/csv" }));

    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/cost/imports"), {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: form,
    });
    const originalContentType = req.headers.get("content-type");
    expect(originalContentType).toMatch(/^multipart\/form-data/);

    const res = await POST(req, context(["cost", "imports"]));

    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: string }];
    // Never parsed into a plain object and never re-serialised: the raw
    // request stream (or, once NextRequest has consumed it once, the same
    // multipart content-type) is what goes out.
    expect((init.headers as Record<string, string>)["content-type"]).toBe(originalContentType);
    expect(init.body).not.toBeUndefined();
    expect(init.duplex).toBe("half");
  });
});

// M2 (R13, R18) — S04's and S09a's xlsx export.
describe("proxy route — binary response passthrough (xlsx export)", () => {
  it("passes an xlsx body and Content-Disposition through unparsed", async () => {
    vi.mocked(getSession).mockResolvedValue({ token: "tok-1", me: {} as Me });
    const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]); // a "PK.." zip header
    const upstream = new Response(xlsxBytes, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="cost-export.xlsx"',
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal("fetch", fetchMock);

    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/projects/p-1/cost/export"));
    const res = await GET(req, context(["projects", "p-1", "cost", "export"]));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="cost-export.xlsx"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(xlsxBytes));
  });

  it("still returns JSON as text when the upstream sends JSON", async () => {
    vi.mocked(getSession).mockResolvedValue({ token: "tok-1", me: {} as Me });
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));

    const req = new NextRequest(new URL("http://localhost:3000/api/proxy/cost/accruals?year=2026"));
    const res = await GET(req, context(["cost", "accruals"]));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
