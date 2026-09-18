import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OrgUnit } from "@ecapital/shared";
import { z } from "zod";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { OrgUnitsService } from "./org-units.service";

@ApiTags("org-units")
@ApiBearerAuth()
@Controller("org-units")
export class OrgUnitsController {
  constructor(private readonly orgUnits: OrgUnitsService) {}

  /**
   * R01, M0 §14: a user sees their own units and nothing else. Central
   * Administration carries all eleven ids and therefore sees all eleven.
   */
  @Get()
  @ApiOperation({ summary: "The org units the caller may see" })
  @ApiZodResponse(200, z.array(OrgUnit), "Eleven units for a central user, fewer for everyone else")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(): Promise<OrgUnit[]> {
    return this.orgUnits.listVisible();
  }
}
