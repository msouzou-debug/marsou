import type { Request } from "express";
import type { TokenClaims } from "@ecapital/shared";

/**
 * The verified token claims, hung on the request by the auth guard.
 * `id` comes from pino-http, which types it as its own ReqId.
 */
export interface AuthenticatedRequest extends Request {
  claims?: TokenClaims;
}

/**
 * The caller's address, for the audit log's `ip` column.
 *
 * `request.ip` is Express's own answer, and Express is the right place to
 * decide it: with `trust proxy` set (ADR-0018 §5, `TRUST_PROXY=1` on the
 * ΟΚΥπΥ server, where cloudflared terminates the hostname on another box) it
 * reads X-Forwarded-For; without it, it reports the socket and ignores the
 * header. Reading the header here instead — which is what this did before
 * ADR-0018 — trusted it on every deployment, including the ones where
 * anybody can reach the port and write whatever address they like into the
 * audit trail.
 */
export function clientIp(request: Request): string | null {
  const candidate = (request.ip ?? request.socket?.remoteAddress ?? "").trim();
  if (!candidate) return null;
  // Express reports IPv4 over IPv6 as ::ffff:10.0.0.1; inet takes either, but
  // the plain form is what an operator expects to read.
  return candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
}
