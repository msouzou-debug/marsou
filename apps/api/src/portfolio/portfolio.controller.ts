import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PortfolioResponse } from "@ecapital/shared";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { PortfolioService } from "./portfolio.service";

@ApiTags("portfolio")
@ApiBearerAuth()
@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  /**
   * R03 — S01 Χαρτοφυλάκιο. Computed from the caller's own projects, so the
   * board sees eleven units and an engineer sees one. The exception
   * sentences come back in both languages at once; the screen picks.
   */
  @Get()
  @ApiOperation({ summary: "The portfolio the caller may see: KPIs, units and exceptions" })
  @ApiZodResponse(200, PortfolioResponse, "KPI strip, one row per visible unit, up to eight exceptions")
  @ApiZodError(401, "No token, or a token that does not verify")
  build(): Promise<PortfolioResponse> {
    return this.portfolio.build(new Date());
  }
}
