import { ProjectDetail } from "@ecapital/shared";
import { NextResponse } from "next/server";
import { buildProjectDetail } from "@/mocks/project-detail";
import { projects } from "@/mocks/projects";

// ADR-0005: GET /api/projects/:id -> ProjectDetail (S03).
//
// RULE (S03, ADR-0010): the real API answers 404 for both "no such project"
// and "a project that exists but is outside the caller's org units" — a row
// policy cannot tell the two apart from the outside, and telling them apart
// here would leak which ids exist. This mock has no row policies to enforce
// (every fixture is visible to whoever asks), so it reproduces only the
// shape of that answer: an unknown id is 404, the same as the real API's
// "not yours".
export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]">) {
  const { id } = await context.params;
  const project = projects.find((p) => p.id === id);
  if (!project) {
    return NextResponse.json({ key: "errors.notFound" }, { status: 404 });
  }
  const detail = ProjectDetail.parse(buildProjectDetail(project));
  return NextResponse.json(detail);
}
