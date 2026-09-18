import { ProjectList } from "@ecapital/shared";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

async function get(query: string): Promise<ProjectList> {
  const response = await GET(new NextRequest(`http://localhost/api/projects${query}`));
  expect(response.status).toBe(200);
  return ProjectList.parse(await response.json());
}

describe("GET /api/projects", () => {
  it("filters by unit — repeated params, ADR-0005/contract ProjectListQuery", async () => {
    const all = await get("");
    const filtered = await get("?unit=nicosia-general");
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.length).toBeLessThan(all.items.length);
    for (const item of filtered.items) expect(item.orgUnitId).toBe("nicosia-general");
  });

  it("filters by more than one unit at once (repeated `unit` params)", async () => {
    const result = await get("?unit=nicosia-general&unit=troodos");
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) expect(["nicosia-general", "troodos"]).toContain(item.orgUnitId);
  });

  it("filters by phase", async () => {
    const result = await get("?phase=CLOSED");
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) expect(item.phase).toBe("CLOSED");
  });

  it("combines unit and phase filters (AND, not OR)", async () => {
    const result = await get("?unit=nicosia-general&phase=CLOSED");
    for (const item of result.items) {
      expect(item.orgUnitId).toBe("nicosia-general");
      expect(item.phase).toBe("CLOSED");
    }
  });

  // RULE (contract ProjectListQuery): `q` matches code and titleEl, case- and
  // accent-insensitively.
  it("matches `q` against the title without regard to accents or case", async () => {
    const accented = await get(`?q=${encodeURIComponent("ανακαινιση")}`); // no tonos, lower-case
    const withAccent = await get(`?q=${encodeURIComponent("Ανακαίνιση")}`);
    expect(accented.total).toBeGreaterThan(0);
    expect(accented.total).toBe(withAccent.total);
    for (const item of accented.items) {
      expect(item.titleEl.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).toContain("ανακαινιση");
    }
  });

  it("matches `q` against the project code", async () => {
    const result = await get("?q=NGH-041");
    expect(result.items.some((item) => item.code === "NGH-041")).toBe(true);
  });

  it("paginates and reports the true total after filtering", async () => {
    const page1 = await get("?pageSize=5&page=1");
    expect(page1.items).toHaveLength(5);
    expect(page1.page).toBe(1);
    expect(page1.total).toBeGreaterThan(5);
  });

  it("returns 400 for an invalid filter value instead of throwing", async () => {
    const response = await GET(new NextRequest("http://localhost/api/projects?phase=NOT_A_PHASE"));
    expect(response.status).toBe(400);
  });
});
