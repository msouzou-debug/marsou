import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AppRole } from "@ecapital/shared";
import { AppError } from "./errors";
import type { AuthenticatedRequest } from "./request-context";

export const REQUIRED_ROLES = "ecapital:roles";

/** Routes that only some roles may call at all, on top of the row policies. */
export const Roles = (...roles: AppRole[]) => SetMetadata(REQUIRED_ROLES, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const held = request.claims?.roles ?? [];
    if (!required.some((role) => held.includes(role))) throw AppError.forbidden();
    return true;
  }
}
