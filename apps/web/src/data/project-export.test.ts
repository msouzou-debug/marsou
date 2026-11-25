import { describe, expect, it, vi } from "vitest";
import { ProjectListQuery, TABLE_EXPORT_MAX_ROWS, type ProjectList } from "@ecapital/shared";
import { allProjectsMatching } from "./queries";

// Owner, 25/11/2026: S02's export is the whole filtered list, every page.
describe("allProjectsMatching", () => {
  function project(n: number): ProjectList["items"][number] {
    return { id: `p-${n}`, code: `NGH-${String(n).padStart(3, "0")}` } as ProjectList["items"][number];
  }

  it("keeps the filters and the sort, ignores the page on screen, and pages 200 at a time", async () => {
    const all = Array.from({ length: 450 }, (_, i) => project(i + 1));
    const fetchPage = vi.fn(async (path: string): Promise<ProjectList> => {
      const url = new URL(path, "http://x");
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("pageSize"));
      return { items: all.slice((page - 1) * size, page * size), total: all.length, page, pageSize: size };
    });
    const query = ProjectListQuery.parse({ unit: ["unit-1"], phase: ["IN_PROGRESS"], q: "στέγη", sort: "code", dir: "asc", page: 3, pageSize: 25 });

    const items = await allProjectsMatching(query, fetchPage);

    expect(items).toHaveLength(450);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    const first = new URL(fetchPage.mock.calls[0][0], "http://x");
    expect(first.searchParams.getAll("unit")).toEqual(["unit-1"]);
    expect(first.searchParams.getAll("phase")).toEqual(["IN_PROGRESS"]);
    expect(first.searchParams.get("q")).toBe("στέγη");
    expect(first.searchParams.get("sort")).toBe("code");
    expect(first.searchParams.get("dir")).toBe("asc");
    expect(first.searchParams.get("pageSize")).toBe("200");
    expect(first.searchParams.get("page")).toBeNull();
  });

  it("stops at what one export may carry", async () => {
    const fetchPage = vi.fn(
      async (): Promise<ProjectList> => ({
        items: Array.from({ length: 200 }, (_, i) => project(i)),
        total: 1_000_000,
        page: 1,
        pageSize: 200,
      }),
    );
    const items = await allProjectsMatching(ProjectListQuery.parse({}), fetchPage);
    expect(items).toHaveLength(TABLE_EXPORT_MAX_ROWS);
  });
});
