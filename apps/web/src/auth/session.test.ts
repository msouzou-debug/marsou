import { beforeEach, describe, expect, it, vi } from "vitest";

// `next/headers` only exists inside a request, so the cookie jar is a stub
// here. Everything else — the fetch, the schema parse, the error mapping —
// is the real code path.
const jar = {
  values: new Map<string, string>(),
  options: new Map<string, unknown>(),
  get(name: string) {
    const value = jar.values.get(name);
    return value === undefined ? undefined : { name, value };
  },
  set(name: string, value: string, options: unknown) {
    jar.values.set(name, value);
    jar.options.set(name, options);
  },
  delete(name: string) {
    jar.values.delete(name);
  },
};

vi.mock("next/headers", () => ({ cookies: async () => jar }));

const { getSession, startSession, endSession, SESSION_COOKIE } = await import("./session");

const me = {
  sub: "dev-estates-nicosia",
  userId: "00000000-0000-0000-0000-00000000e5e5",
  name: "Ανδρέας Παπαδόπουλος",
  email: "estates.nicosia@ecapital.test",
  roles: ["estates_head"],
  orgUnitIds: ["nicosia-general"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  jar.values.clear();
  jar.options.clear();
  vi.restoreAllMocks();
});

describe("getSession", () => {
  it("is null when there is no cookie, and asks the API nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await getSession()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the user and the token when /me accepts the cookie", async () => {
    jar.values.set(SESSION_COOKIE, "a-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(me));
    const session = await getSession();
    expect(session?.token).toBe("a-token");
    expect(session?.me.name).toBe("Ανδρέας Παπαδόπουλος");
    expect(session?.me.orgUnitIds).toEqual(["nicosia-general"]);
  });

  it("is null when the cookie is there but /me rejects it", async () => {
    jar.values.set(SESSION_COOKIE, "an-expired-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ key: "errors.notSignedIn" }, 401),
    );
    expect(await getSession()).toBeNull();
  });
});

describe("startSession", () => {
  it("keeps the token in an httpOnly, sameSite=lax cookie", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ token: "fresh-token", claims: me }, 201),
    );
    const result = await startSession("estates.nicosia@ecapital.test");
    expect(result).toEqual({ ok: true });
    expect(jar.values.get(SESSION_COOKIE)).toBe("fresh-token");
    // RULE (ADR-0013): the token must not be reachable from client JavaScript.
    expect(jar.options.get(SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("says development sign-in is off when the route answers 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ key: "errors.routeNotFound" }, 404),
    );
    expect(await startSession("admin@ecapital.test")).toEqual({ ok: false, error: "devAuthOff" });
    expect(jar.values.has(SESSION_COOKIE)).toBe(false);
  });

  it("tells an unknown address apart from a switched-off stub", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ key: "errors.userNotFound" }, 404),
    );
    expect(await startSession("nobody@ecapital.test")).toEqual({
      ok: false,
      error: "unknownAccount",
    });
  });

  it("reports an unreachable API rather than a wrong address", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await startSession("admin@ecapital.test")).toEqual({ ok: false, error: "unreachable" });
  });

  it("asks for an address before calling anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await startSession("   ")).toEqual({ ok: false, error: "emailNeeded" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("endSession", () => {
  it("forgets the cookie", async () => {
    jar.values.set(SESSION_COOKIE, "a-token");
    await endSession();
    expect(jar.values.has(SESSION_COOKIE)).toBe(false);
  });
});
