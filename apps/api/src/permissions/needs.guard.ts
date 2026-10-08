import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { atLeast, type AccessLevel, type MatrixArea } from "@ecapital/shared";
import { AppError } from "../common/errors";
import type { AuthenticatedRequest } from "../common/request-context";
import { PermissionsService } from "./permissions.service";

export const REQUIRED_PERMISSIONS = "ecapital:needs";

/** One row of the role matrix and the least level the route asks for on it. */
export type Need = readonly [area: MatrixArea, level: AccessLevel];

/**
 * ADR-0033. A route that only some roles may call at all, said as a row of
 * the role matrix instead of a list of roles, so the administrator's change
 * on «Ρόλοι και δικαιώματα» is what the route obeys at the next request.
 *
 *   @Needs("variationDecide", "APPROVE")
 *
 * The row policies underneath still decide which rows the caller reaches
 * (ADR-0010); this only turns away, with 403, a caller the matrix gives too
 * little.
 */
export const Needs = (area: MatrixArea, level: AccessLevel) =>
  SetMetadata(REQUIRED_PERMISSIONS, [[area, level]] satisfies Need[]);

/**
 * The same, satisfied by any one of several rows — for a route that serves
 * two kinds of work, such as a document that may belong to the contract team
 * or to finance's side of a certificate.
 */
export const NeedsAny = (...needs: Need[]) => SetMetadata(REQUIRED_PERMISSIONS, needs);

/**
 * Registered once, globally, after the token guard (app.module.ts). A route
 * without `@Needs` passes through, after the copy of the matrix is refreshed.
 */
@Injectable()
export class NeedsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const needs = this.reflector.getAllAndOverride<Need[] | undefined>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Every signed-in request, with `@Needs` or without: the services that
    // ask the matrix in code (the inbox, a certificate's next step) read the
    // same copy, so it is brought up to date here, once, for all of them.
    if (request.claims) await this.permissions.fresh();
    if (!needs?.length) return true;

    const roles = request.claims?.roles ?? [];
    if (!needs.some(([area, level]) => this.permissions.allowed({ roles }, area, level))) {
      // RULE (ADR-0010): a read-only account is told it is read-only, the
      // sentence the row policies' refusal has always produced, rather than
      // the general «not allowed».
      const writes = needs.some(([, level]) => atLeast(level, "WRITE"));
      const readOnly = roles.some((role) => role === "auditor_readonly" || role === "executive_readonly");
      throw AppError.forbidden(writes && readOnly ? "errors.readOnlyAccount" : "errors.notAllowed");
    }
    return true;
  }
}
