import { PortfolioResponse } from "@ecapital/shared";
import { NextResponse } from "next/server";
import { buildPortfolio } from "@/mocks/portfolio";

// ADR-0005: mock data behind a route handler. GET /api/portfolio -> S01's
// PortfolioResponse (R03), validated through the shared zod schema before
// it goes out so the fixture can never drift from the contract the real
// NestJS API will also have to meet.
export async function GET() {
  const data = buildPortfolio(new Date());
  const validated = PortfolioResponse.parse(data);
  return NextResponse.json(validated);
}
