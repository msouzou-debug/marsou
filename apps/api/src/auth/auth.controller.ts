import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { currentTx } from "../db/client";
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LoginRequest, Me, type TokenClaims } from "@ecapital/shared";
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
  async me(@Req() request: AuthenticatedRequest): Promise<Me> {
    const claims = request.claims;
    if (!claims) throw AppError.unauthorized();
    // The app_user row id, read inside the caller's own RLS transaction. A
    // verified token whose subject has no row means the directory and the
    // seed have drifted — not the caller's fault, so it is a 500, not a 401.
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(eq(schema.appUser.subject, claims.sub))
      .limit(1);
    if (!rows.length) throw AppError.internal();
    return Me.parse({
      sub: claims.sub,
      userId: rows[0].id,
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
    return session(await this.auth.devTokenFor(parsed.data.email));
  }

  /**
   * ADR-0018, `AUTH_MODE=ldap`. Username and password, checked by a simple
   * bind against the ΟΚΥπΥ Active Directory; the answer is the same token and
   * the same claims the development stub hands back, so the web app's cookie,
   * the guard and every policy underneath are untouched by which mode is on.
   *
   * In `dev` and `oidc` mode this route answers 404, the same way
   * `/auth/dev-token` does outside `dev` — a route that is not the way in for
   * this deployment does not exist for this deployment.
   *
   * RULE: the password is read here and passed straight to the directory. It
   * is not logged (pino redacts `req.body` outright, app.module.ts), not
   * stored and not echoed back.
   */
  @Public()
  @Post("auth/login")
  @ApiOperation({ summary: "Sign in with a ΟΚΥπΥ Active Directory account" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { username: { type: "string" }, password: { type: "string", format: "password" } },
      required: ["username", "password"],
    },
  })
  @ApiZodResponse(201, DevTokenResponse, "A token valid for eight hours")
  @ApiZodError(400, "The body carries no username or no password")
  @ApiZodError(401, "The directory refused the credentials")
  @ApiZodError(404, "AUTH_MODE is not ldap, so this route does not exist")
  async login(@Body() body: unknown) {
    const parsed = LoginRequest.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.credentialsNeeded");
    return session(await this.auth.login(parsed.data.username, parsed.data.password));
  }
}

/** The one response shape both ways in produce (ADR-0018). */
function session({ token, claims, userId }: { token: string; claims: TokenClaims; userId: string }) {
  return {
    token,
    claims: Me.parse({
      sub: claims.sub,
      userId,
      name: claims.name,
      email: claims.email,
      roles: claims.roles,
      orgUnitIds: claims.org_unit_ids,
    }),
  };
}
