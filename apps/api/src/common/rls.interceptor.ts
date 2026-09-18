import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { from, lastValueFrom, type Observable } from "rxjs";
import { DatabaseService } from "../db/client";
import { type AuthenticatedRequest, clientIp } from "./request-context";

/**
 * ADR-0010. Every authenticated request runs inside one transaction that
 * carries the caller's identity into the database session, so row-level
 * security decides what the request can see — not a `where` clause somebody
 * can forget. The transaction commits when the handler resolves and rolls
 * back when it throws, which also means a failed mutation leaves no audit row
 * claiming it happened.
 *
 * An unauthenticated route (only /health in M0) runs outside a transaction
 * and can therefore reach nothing that has a policy on it.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(private readonly db: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = request.claims;
    if (!claims) return next.handle();

    return from(
      this.db.withRls(
        {
          userId: claims.sub,
          roles: claims.roles,
          orgUnitIds: claims.org_unit_ids,
          ip: clientIp(request),
        },
        () => lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
