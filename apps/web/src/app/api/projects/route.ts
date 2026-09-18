import { ProjectList, ProjectListQuery, ProjectPhase, type ProjectSort, type ProjectSummary } from "@ecapital/shared";
import { NextResponse, type NextRequest } from "next/server";
import { orgUnits } from "@/mocks/org-units";
import { projects } from "@/mocks/projects";

// ADR-0005: GET /api/projects?<ProjectListQuery> -> ProjectList (S02).
//
// Query shape matches the contract's `ProjectListQuery` one-to-one: array
// filters (`unit`, `phase`, `category`, `rag`) as repeated params
// (`?unit=a&unit=b`), `q` matched case- and accent-insensitively against
// code and titleEl, `sort`/`dir`, `page`/`pageSize`. This is a fixture
// filter, not a database query, but it is written to the same query object
// the real API will parse so a screen built against this handler needs no
// change when M1 swaps the data source (R15).

// Strips combining diacritics after NFD decomposition — works for Greek
// tonos/dialytika the same way it works for Latin accents.
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function parseQuery(searchParams: URLSearchParams): ProjectListQuery {
  return ProjectListQuery.parse({
    unit: searchParams.getAll("unit"),
    phase: searchParams.getAll("phase"),
    category: searchParams.getAll("category"),
    rag: searchParams.getAll("rag"),
    q: searchParams.get("q") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    dir: searchParams.get("dir") ?? undefined,
    page: searchParams.has("page") ? Number(searchParams.get("page")) : undefined,
    pageSize: searchParams.has("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
  });
}

const orgUnitNameById = new Map(orgUnits.map((u) => [u.id, u.nameEl] as const));
const PHASE_ORDER = ProjectPhase.options;
const RAG_ORDER = { GREEN: 0, AMBER: 1, RED: 2 } as const;

function sortValue(project: ProjectSummary, sort: ProjectSort): string | number {
  switch (sort) {
    case "titleEl":
      return normalize(project.titleEl);
    case "code":
      return project.code;
    case "orgUnit":
      return normalize(orgUnitNameById.get(project.orgUnitId) ?? project.orgUnitId);
    case "phase":
      return PHASE_ORDER.indexOf(project.phase);
    case "approvedBudget":
      return project.approvedBudget;
    case "plannedFinish":
      // RULE: a project with no planned finish sorts last regardless of
      // direction — never first, where it would read as "most urgent".
      return project.plannedFinish ?? "9999-99-99";
    case "rag":
      return RAG_ORDER[project.rag];
    case "updatedAt":
      return project.updatedAt ?? "";
  }
}

export async function GET(request: NextRequest) {
  let query: ProjectListQuery;
  try {
    query = parseQuery(request.nextUrl.searchParams);
  } catch {
    return NextResponse.json({ key: "errors.invalidQuery" }, { status: 400 });
  }

  const q = query.q ? normalize(query.q) : "";
  const filtered = projects.filter((project) => {
    if (query.unit.length > 0 && !query.unit.includes(project.orgUnitId)) return false;
    if (query.phase.length > 0 && !query.phase.includes(project.phase)) return false;
    if (query.category.length > 0 && !query.category.includes(project.category)) return false;
    if (query.rag.length > 0 && !query.rag.includes(project.rag)) return false;
    if (q && !normalize(project.code).includes(q) && !normalize(project.titleEl).includes(q)) return false;
    return true;
  });

  const dir = query.dir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a, query.sort);
    const bv = sortValue(b, query.sort);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const total = sorted.length;
  const from = (query.page - 1) * query.pageSize;
  const items = sorted.slice(from, from + query.pageSize);

  const result = ProjectList.parse({ items, total, page: query.page, pageSize: query.pageSize });
  return NextResponse.json(result);
}
