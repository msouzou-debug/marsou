import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Area, AreaCreate, AreaTree } from "@ecapital/shared";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { AreasService } from "./areas.service";

@ApiTags("areas")
@ApiBearerAuth()
@Controller("org-units/:id/areas")
export class AreasController {
  constructor(private readonly areas: AreasService) {}

  /**
   * R01 and the M0 definition of done: a user sees their own unit's area tree
   * and nothing else. A unit the caller has no access to answers 404, not
   * 403 — see the comment on AreasService.treeFor.
   */
  @Get()
  @ApiOperation({ summary: "The building, floor and area tree of one org unit" })
  @ApiParam({ name: "id", schema: { type: "string" }, description: "Org unit id, for example nicosia-general" })
  @ApiZodResponse(200, AreaTree, "The tree, buildings ordered by code")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such unit, or none the caller may see")
  tree(@Param("id") id: string): Promise<AreaTree> {
    return this.areas.treeFor(id);
  }

  @Post()
  @ApiOperation({ summary: "Add an area to a floor of this unit" })
  @ApiParam({ name: "id", schema: { type: "string" }, description: "Org unit id" })
  @ApiBody({ schema: jsonSchema(AreaCreate) as never })
  @ApiZodResponse(201, Area, "The area as stored")
  @ApiZodError(400, "The body is not a valid area")
  @ApiZodError(403, "A read-only account, or a unit the caller may not write to")
  @ApiZodError(404, "No such floor in this unit")
  create(@Param("id") id: string, @Body() body: unknown): Promise<Area> {
    const parsed = AreaCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.areaNotValid");
    return this.areas.create(id, parsed.data);
  }
}
