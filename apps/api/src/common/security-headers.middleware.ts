import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/**
 * The response headers every answer carries, so the browser never lets a
 * page of ours be framed by somebody else's and never guesses a type.
 *
 * Clickjacking (pentest finding of 05/11/2026 against the estate): a page
 * loaded invisibly inside an attacker's frame still carries the victim's
 * session, so a click on the decoy lands on us. `frame-ancestors 'none'`
 * is the control; `X-Frame-Options: DENY` is the same rule for browsers
 * that predate it. Nothing in eCapital frames anything, so 'none' costs
 * nothing.
 *
 * RULE: a route that already set Content-Security-Policy keeps its own — the
 * document route's sandbox for a filed HTML file carries frame-ancestors
 * itself (documents.controller.ts). Headers are set before the handler runs,
 * so a handler can always be more specific, never less.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction): void {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.getHeader(name)) response.setHeader(name, value);
    }
    next();
  }
}
