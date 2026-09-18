import type { Request } from "express";
import type { TokenClaims } from "@ecapital/shared";

/**
 * The verified token claims, hung on the request by the auth guard.
 * `id` comes from pino-http, which types it as its own ReqId.
 */
export interface AuthenticatedRequest extends Request {
  claims?: TokenClaims;
}

/** Best guess at the caller's address, for the audit log's `ip` column. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  const candidate = (first ?? request.ip ?? "").trim();
  if (!candidate) return null;
  // Express reports IPv4 over IPv6 as ::ffff:10.0.0.1; inet takes either, but
  // the plain form is what an operator expects to read.
  return candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
}
