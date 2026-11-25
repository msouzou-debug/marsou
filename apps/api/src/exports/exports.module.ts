import type { IncomingMessage } from "node:http";
import { Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ExportsController } from "./exports.controller";
import { TABLE_EXPORT_BODY_LIMIT } from "./table-export";

/**
 * The generic table export (UAT 25/11/2026). No table and no service: the
 * rows arrive in the request and leave as a workbook (`table-export.ts`).
 */
@Module({
  controllers: [ExportsController],
})
export class ExportsModule {}

/**
 * Nest's JSON parser takes 100 kB, which a screen of a few thousand rows is
 * over. Raising it for every route would let any body be 80 times larger,
 * so the larger limit is this one route's: a parser that only answers to
 * `POST /exports/table` goes first, then the default one for everything
 * else (body-parser leaves a body that is already parsed alone). Called
 * before `init`/`listen`, so Nest sees a `jsonParser` already in place and
 * does not add a third.
 */
export function useTableExportBodyParser(app: NestExpressApplication): void {
  app.useBodyParser("json", {
    limit: TABLE_EXPORT_BODY_LIMIT,
    type: (req: IncomingMessage) =>
      req.method === "POST" &&
      /^\/exports\/table(?:\?|$)/.test(req.url ?? "") &&
      /^application\/json\b/i.test(req.headers["content-type"] ?? ""),
  });
  app.useBodyParser("json");
}
