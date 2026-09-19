import { Controller, Get, Inject } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ConfigLinks } from "@ecapital/shared";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { CONFIG, type AppConfig } from "../config";

/**
 * ADR-0019 §4 — where the sibling systems live.
 *
 * eCapital, eMAP (procurement) and eFinance (invoices and budget) run on the
 * same ΟΚΥπΥ server behind the same cloudflared box, and a screen that wants
 * to offer «Άνοιγμα στο eMAP» needs to know the host. It is configuration,
 * not a constant: the three systems are reached by different hostnames in
 * UAT and in production, and a base URL compiled into the web bundle is a
 * rebuild every time one of them moves.
 *
 * Signed in, but no role: a link is not data. Everything behind the link is
 * still the other system's decision to make about the caller.
 */
@ApiTags("config")
@ApiBearerAuth()
@Controller("config")
export class LinksController {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  @Get("links")
  @ApiOperation({ summary: "Base URLs of the sibling systems, or null where there is none" })
  @ApiZodResponse(200, ConfigLinks, "Both may be null; null means do not offer the link")
  @ApiZodError(401, "No token, or a token that does not verify")
  links(): ConfigLinks {
    return {
      // Trailing slashes stripped so a caller can append a path without
      // producing `https://map.shso.online//contracts`.
      emapUrl: trimmed(this.config.EMAP_URL),
      efinanceUrl: trimmed(this.config.EFINANCE_URL),
    };
  }
}

function trimmed(value: string | undefined): string | null {
  const url = value?.trim().replace(/\/+$/, "");
  return url ? url : null;
}
