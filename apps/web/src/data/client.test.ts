import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiMutate, ApiError } from "./client";

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

  it("falls back to a generic message when the error body carries no message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502 })));
    const error = await apiMutate("/projects", "POST", {}, schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toContain("502");
  });
});
