import { ProjectDetail } from "@ecapital/shared";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { projects } from "@/mocks/projects";
import { GET } from "./route";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/projects/:id", () => {
  it("returns a full ProjectDetail for a known id", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/projects/${projects[0].id}`), context(projects[0].id));
    expect(response.status).toBe(200);
    const detail = ProjectDetail.parse(await response.json());
    expect(detail.id).toBe(projects[0].id);
    expect(detail.milestones.length).toBeGreaterThanOrEqual(2);
    expect(detail.milestones.length).toBeLessThanOrEqual(4);
    expect(detail.milestones.some((m) => m.isGate)).toBe(true);
  });

  // RULE (S03, ADR-0010): the 404 is the RLS answer — "no such project" and
  // "not yours" must not be distinguishable from the outside.
  it("answers 404 for an unknown id, the same shape an RLS-hidden project would get", async () => {
    const response = await GET(new NextRequest("http://localhost/api/projects/does-not-exist"), context("does-not-exist"));
    expect(response.status).toBe(404);
  });
});
