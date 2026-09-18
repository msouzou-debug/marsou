import { ProjectSummary } from "@ecapital/shared";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { projects } from "@/mocks/projects";

// ADR-0005: GET /api/projects[?unit=<orgUnitId>] -> ProjectSummary[].
export async function GET(request: NextRequest) {
  const unit = request.nextUrl.searchParams.get("unit");
  const rows = unit ? projects.filter((p) => p.orgUnitId === unit) : projects;
  const validated = z.array(ProjectSummary).parse(rows);
  return NextResponse.json(validated);
}
