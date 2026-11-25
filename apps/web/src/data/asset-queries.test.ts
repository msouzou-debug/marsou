import { describe, expect, it, vi } from "vitest";
import type { ProjectList } from "@ecapital/shared";
import { allProjectsForUnit, byRef, documentContentHref, documentViewHref, isViewableMime } from "./queries";

// UAT 25/11/2026 — S17a's source selects and the document links.
describe("allProjectsForUnit", () => {
  function project(n: number): ProjectList["items"][number] {
    return { id: `p-${n}`, code: `NGH-${String(n).padStart(3, "0")}` } as ProjectList["items"][number];
  }

  it("asks for every phase, by code, and pages until it holds the total", async () => {
    const all = Array.from({ length: 450 }, (_, i) => project(i + 1));
    const fetchPage = vi.fn(async (path: string): Promise<ProjectList> => {
      const url = new URL(path, "http://x");
      // Page 1 is the default and is left out of the URL, as the API reads it.
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("pageSize"));
      return { items: all.slice((page - 1) * size, page * size), total: all.length, page, pageSize: size };
    });

    const result = await allProjectsForUnit("unit-1", fetchPage);

    expect(result.items).toHaveLength(450);
    expect(result.total).toBe(450);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    const first = new URL(fetchPage.mock.calls[0][0], "http://x");
    expect(first.searchParams.getAll("unit")).toEqual(["unit-1"]);
    expect(first.searchParams.getAll("phase")).toEqual([]);
    expect(first.searchParams.get("sort")).toBe("code");
    expect(first.searchParams.get("dir")).toBe("asc");
  });

  it("stops after one page when the unit has few projects", async () => {
    const fetchPage = vi.fn(async (): Promise<ProjectList> => ({ items: [project(1), project(2)], total: 2, page: 1, pageSize: 200 }));
    expect((await allProjectsForUnit("unit-1", fetchPage)).items).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe("byRef", () => {
  it("lists contracts by reference, numbers in number order", () => {
    expect(byRef([{ ref: "CAP-2026-0010" }, { ref: "CAP-2025-0002" }, { ref: "CAP-2026-0002" }]).map((c) => c.ref)).toEqual([
      "CAP-2025-0002",
      "CAP-2026-0002",
      "CAP-2026-0010",
    ]);
  });
});

describe("document links", () => {
  it("views a PDF or an image inline and saves anything else", () => {
    expect(isViewableMime("application/pdf")).toBe(true);
    expect(isViewableMime("IMAGE/JPEG")).toBe(true);
    expect(isViewableMime("image/tiff")).toBe(false);
    expect(isViewableMime("text/html")).toBe(false);
    expect(isViewableMime(null)).toBe(false);
    expect(documentViewHref("d 1", "application/pdf")).toBe("/api/proxy/documents/d%201/content");
    expect(documentViewHref("d-2", "application/zip")).toBe("/api/proxy/documents/d-2/content?download=1");
    expect(documentContentHref("d-3", { download: true })).toBe("/api/proxy/documents/d-3/content?download=1");
    expect(documentContentHref("d-3")).toBe("/api/proxy/documents/d-3/content");
  });
});
