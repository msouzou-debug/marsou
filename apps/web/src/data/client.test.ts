import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import el from "@/i18n/el.json";
import { apiMutate, ApiError, proxyFetch } from "./client";
import { DEFAULT_ERROR_TEXTS, SESSION_EXPIRED_EVENT, setErrorTexts, signInHrefFor } from "./session-expiry";

const schema = z.object({ id: z.string() });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiMutate", () => {
  it("POSTs through the same-origin proxy and parses the response with the schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "PRJ-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiMutate("/projects", "POST", { titleEl: "Έργο" }, schema);

    expect(result).toEqual({ id: "PRJ-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/projects");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ titleEl: "Έργο" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  // RULE: `{key, message, requestId}` (apps/api's `HttpExceptionFilter`) —
  // `.message` is the API's own sentence, already in the caller's language,
  // so a form can show it verbatim instead of re-translating `.key`.
  it("throws an ApiError carrying the API's own status, key and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(422, {
          key: "errors.gateOpen",
          message: "Το ορόσημο «Έγκριση μελέτης» κλείνει το τρέχον στάδιο και δεν έχει ολοκληρωθεί.",
          requestId: "req-1",
        }),
      ),
    );

    await expect(apiMutate("/projects/PRJ-1/phase", "POST", { phase: "APPROVED", reasonEl: "x" }, schema)).rejects.toMatchObject({
      status: 422,
      key: "errors.gateOpen",
      message: "Το ορόσημο «Έγκριση μελέτης» κλείνει το τρέχον στάδιο και δεν έχει ολοκληρωθεί.",
    });
  });

  // OWNER UAT 25/11/2026: never «Request to … failed with …» in front of a user.
  it("falls back to the generic Greek sentence when the error body carries no message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 })));
    const error = await apiMutate("/projects", "POST", {}, schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toBe(el.states.error.generic);
    expect((error as ApiError).message).not.toMatch(/Request to|failed with/);
  });

  it("uses the sentences the provider registered, in the app's language", async () => {
    setErrorTexts({ sessionExpired: "Your session has expired. Sign in again.", generic: "Something went wrong.", unreachable: "Not answering." });
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { key: "errors.x" })));
      await expect(proxyFetch("/projects", schema)).rejects.toMatchObject({ message: "Something went wrong." });
    } finally {
      setErrorTexts(DEFAULT_ERROR_TEXTS);
    }
  });

  it("says a 401 is the session having ended and tells the open page", async () => {
    const heard = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { key: "errors.notSignedIn" })));
      const error = await apiMutate("/contracts/c-1/rfis", "POST", {}, schema).catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 401, key: "errors.notSignedIn", message: "Η σύνδεσή σας έληξε. Συνδεθείτε ξανά." });
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
    }
  });

  it("does the same for a read (a TanStack query) that meets a 401", async () => {
    const heard = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
      await expect(proxyFetch("/projects", schema)).rejects.toMatchObject({ status: 401, message: "Η σύνδεσή σας έληξε. Συνδεθείτε ξανά." });
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
    }
  });

  it("says in a sentence that eCapital is not answering when the request never got through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiMutate("/projects", "POST", {}, schema)).rejects.toMatchObject({
      status: 0,
      message: el.states.error.unreachable,
    });
  });

  it("keeps an abort an abort", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(apiMutate("/projects", "POST", {}, schema)).rejects.toBe(abort);
  });
});

describe("session expiry", () => {
  it("keeps the built-in sentences equal to el.json", () => {
    expect(DEFAULT_ERROR_TEXTS).toEqual({
      sessionExpired: el.states.error.sessionExpired,
      generic: el.states.error.generic,
      unreachable: el.states.error.unreachable,
    });
  });

  it("sends the user to sign-in and back to the same page", () => {
    expect(signInHrefFor("/contracts/c-1/rfis?x=1")).toBe("/sign-in?expired=1&next=%2Fcontracts%2Fc-1%2Frfis%3Fx%3D1");
  });

  it("never sends them on to another site or back to sign-in", () => {
    expect(signInHrefFor("//evil.example/x")).toBe("/sign-in?expired=1");
    expect(signInHrefFor("/sign-in?next=/")).toBe("/sign-in?expired=1");
  });
});
