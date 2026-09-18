import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Public } from "../auth/public.decorator";
import { ApiZodResponse } from "../common/openapi";
import { HealthService } from "./health.service";

export const Health = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.boolean().describe("Whether the database answered"),
  lastMigrationId: z.string().nullable(),
  at: z.string().describe("UTC, ISO 8601"),
});
export type Health = z.infer<typeof Health>;

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Open, because whatever polls it — the load balancer, the ops team's
   * dashboard — has no token. It answers with the state of the process and
   * nothing about the data: no counts, no names, no unit list.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: "Is the database reachable and which migration is applied" })
  @ApiZodResponse(200, Health, "Healthy")
  @ApiZodResponse(503, Health, "The database did not answer")
  async check(@Res({ passthrough: true }) response: Response): Promise<Health> {
    const health = await this.health.check();
    response.status(health.db ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return health;
  }
}
