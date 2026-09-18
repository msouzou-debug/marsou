import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Observable } from "rxjs";
import { IS_PUBLIC } from "../auth/public.decorator";
import { currentTx } from "../db/client";
import { AppError } from "./errors";
import type { AuthenticatedRequest } from "./request-context";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * R42, belt and braces. A mutating route that is not inside the RLS
 * transaction has no `app.user_id`, so the audit trigger would record the
 * change with no actor. Rather than let that happen the request is refused.
 *
 * This fires before the handler, and it catches the case the RLS interceptor
 * cannot: a mutating route that somehow skipped the auth guard.
 *
 * A route marked @Public has no caller to attribute anything to and touches
 * nothing that has a policy on it. In M0 that is exactly one mutating route,
 * the development token issuer, which does not exist in production. Anything
 * else that writes must be authenticated and therefore inside the transaction.
 */
@Injectable()
export class MutationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MutationInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic && MUTATING.has(request.method) && !currentTx()) {
      this.logger.error(
        `refused ${request.method} ${request.url}: not inside the row-level-security transaction`,
      );
      throw AppError.internal("errors.unexpected");
    }
    return next.handle();
  }
}
