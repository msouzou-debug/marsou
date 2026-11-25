import { Body, Controller, Headers, HttpCode, Post, Res, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { TableExportRequest } from "@ecapital/shared";
import type { Response } from "express";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { ApiZodError, jsonSchema } from "../common/openapi";
import { fileNameOf, tableWorkbook } from "./table-export";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** RFC 5987: the `filename*` value, so a Greek title survives the header. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The generic table export (UAT 25/11/2026; `table-export.ts`).
 *
 * Any signed-in user: there is no `@Needs`, because the rows are the ones
 * the caller's screen already showed — they came through the row policies
 * on the way in (ADR-0010), and this route reads nothing from the database.
 * A POST, not a GET, only because the rows travel in the body; nothing is
 * written. The body limit is its own (`TABLE_EXPORT_BODY_LIMIT`, main.ts),
 * and the row and column caps are the schema's.
 */
@ApiTags("exports")
@ApiBearerAuth()
@Controller("exports")
export class ExportsController {
  constructor(private readonly i18n: I18nService) {}

  @Post("table")
  @HttpCode(200)
  @ApiOperation({ summary: "A screen's table as Excel: frozen header, autofilter, formats and live SUBTOTAL totals" })
  @ApiBody({ schema: jsonSchema(TableExportRequest) as never })
  @ApiProduces(XLSX)
  @ApiResponse({
    status: 200,
    description: "The workbook: the rows with live totals, and a sheet that says which screen and when",
    content: { [XLSX]: { schema: { type: "string", format: "binary" } } },
  })
  @ApiZodError(400, "Not a table, or more than 20.000 rows (errors.tableExportNotValid)")
  async table(
    @Body() body: unknown,
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const parsed = TableExportRequest.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.tableExportNotValid");
    const now = new Date();
    const file = await tableWorkbook(parsed.data, this.i18n, { locale: this.i18n.resolve(acceptLanguage), now });
    const name = fileNameOf(parsed.data.title, now);
    response.setHeader("Content-Type", XLSX);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${rfc5987(name)}`,
    );
    return new StreamableFile(file);
  }
}
