import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../common/request-context";
import { AuthService } from "./auth.service";
import { IS_PUBLIC } from "./public.decorator";

/**
 * R01. One guard for both ways in (ADR-0009): the Entra ID token in
 * production and the development stub's token carry the same claims, so this
 * code does not branch on which is which. No token, or a token that does not
 * verify, is 401 — never 403, which would tell a stranger the route exists.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.claims = await this.auth.claimsFromBearer(request.headers.authorization);
    return true;
  }
}
