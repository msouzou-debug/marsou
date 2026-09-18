import { OrgUnit } from "@ecapital/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { orgUnits } from "@/mocks/org-units";

// ADR-0005: GET /api/org-units -> OrgUnit[], seeded from CAPEX-03 §3.
// Validating through the schema also strips the mock-only `aliases`
// field, which is import-matching metadata, not part of the API contract.
export async function GET() {
  const validated = z.array(OrgUnit).parse(orgUnits);
  return NextResponse.json(validated);
}
