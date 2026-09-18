import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Me } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import type { AuthenticatedRequest } from "../common/request-context";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";

const DevTokenRequest = z.object({ email: z.string().email() });
const DevTokenResponse = z.object({ token: z.string(), claims: Me });

@ApiTags("auth")
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** R01. What the token says about you, after it has been verified. */
  @Get("me")
  @ApiOperation({ summary: "The signed-in user, their roles and their org units" })
  @ApiZodResponse(200, Me, "The caller's claims")
  @ApiZodError(401, "No token, or a token that does not verify")
  me(@Req() request: AuthenticatedRequest): Me {
    const claims = request.claims;
    if (!claims) throw AppError.unauthorized();
    return Me.parse({
      sub: claims.sub,
      name: claims.name,
      email: claims.email,
      roles: claims.roles,
      orgUnitIds: claims.org_unit_ids,
    });
  }

  /**
   * ADR-0009, development only. Hands back a signed token for a seeded user
   * so the app can be opened without an Entra ID tenant. With DEV_AUTH off
   * this route answers 404, the same as a route that does not exist — because
   * as far as production is concerned it does not.
   */
  @Public()
  @Post("auth/dev-token")
  @ApiOperation({ summary: "Development only: a signed token for a seeded user" })
  @ApiBody({ schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } })
  @ApiZodResponse(201, DevTokenResponse, "A token valid for eight hours")
  @ApiZodError(404, "DEV_AUTH is off, or no seeded user has that address")
  async devToken(@Body() body: unknown) {
    const parsed = DevTokenRequest.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.emailNeeded");
    const { token, claims } = await this.auth.devTokenFor(parsed.data.email);
    return {
      token,
      claims: Me.parse({
        sub: claims.sub,
        name: claims.name,
        email: claims.email,
        roles: claims.roles,
        orgUnitIds: claims.org_unit_ids,
      }),
    };
  }
}
