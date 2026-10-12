import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { RolesGuard } from "../common/roles.guard";
import { NeedsAny } from "../permissions/needs.guard";
import { DocumentRecord } from "./dms-contracts";
import { DocumentsService, type UploadInput } from "./documents.service";
import { MAX_FILE_BYTES, MIME_WHITELIST } from "./earchive-contract";

/**
 * M8 — the three things eCapital files with eArchive today: the award
 * decision on a contract, the business case behind a project and an approved
 * variation. Permits come with M5 and payment certificates later; both
 * already have a `source_module` in the contract so that adding them is a
 * route and not a migration.
 *
 * RULE (ADR-0023): the upload writes the `document` row and the `dms_outbox`
 * row in one transaction. What the caller gets back is the record with
 * `outboxStatus: "QUEUED"`; the protocol number arrives later, when eArchive
 * has answered, and never from here.
 *
 * Nothing here decides which contracts or projects a caller can see. The row
 * policies do, and one in a unit the caller may not read answers 404
 * (ADR-0010).
 */
const UPLOAD_BODY = {
  type: "object",
  required: ["file"],
  properties: {
    file: { type: "string", format: "binary" },
    titleEl: {
      type: "string",
      description: "The title on the folder. Left out, the subject line is used.",
    },
    mime: {
      type: "string",
      enum: MIME_WHITELIST.map(String),
      description: "Overrides the browser's guess. eArchive's whitelist, nothing else.",
    },
  },
};

@ApiTags("documents")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post("contracts/:id/documents")
  @HttpCode(201)
  @NeedsAny(["contractRecords", "WRITE"], ["paymentCertFinance", "APPROVE"])
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File the award decision on a contract with eArchive" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: UPLOAD_BODY })
  @ApiZodResponse(201, DocumentRecord, "The document, queued for eArchive")
  @ApiZodError(400, "No file, or a file name that is not usable")
  @ApiZodError(403, "A role that does not file documents, or a unit the caller may not write")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(409, "That item is already filed under the same reference")
  @ApiZodError(422, "A file type eArchive does not accept, or one over 50 MB")
  awardDecision(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<DocumentRecord> {
    return this.documents.fileAwardDecision(id, upload(file, body));
  }

  @Get("contracts/:id/documents")
  @ApiOperation({ summary: "The documents filed against a contract, newest version first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(DocumentRecord), "The documents, newest version first")
  @ApiZodError(401, "No token, or a token that does not verify")
  contractDocuments(@Param("id") id: string): Promise<DocumentRecord[]> {
    return this.documents.listFor("contract", id);
  }

  @Post("projects/:id/documents")
  @HttpCode(201)
  @NeedsAny(["contractRecords", "WRITE"], ["paymentCertFinance", "APPROVE"])
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File a project's business case with eArchive" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: UPLOAD_BODY })
  @ApiZodResponse(201, DocumentRecord, "The document, queued for eArchive")
  @ApiZodError(400, "No file, or a file name that is not usable")
  @ApiZodError(403, "A role that does not file documents, or a unit the caller may not write")
  @ApiZodError(404, "No such project, or none the caller may see")
  @ApiZodError(409, "That item is already filed under the same reference")
  @ApiZodError(422, "A file type eArchive does not accept, or one over 50 MB")
  businessCase(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<DocumentRecord> {
    return this.documents.fileBusinessCase(id, upload(file, body));
  }

  @Get("projects/:id/documents")
  @ApiOperation({ summary: "The documents filed against a project, newest version first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(DocumentRecord), "The documents, newest version first")
  @ApiZodError(401, "No token, or a token that does not verify")
  projectDocuments(@Param("id") id: string): Promise<DocumentRecord[]> {
    return this.documents.listFor("project", id);
  }

  /**
   * RULE (eArchive brief, R10): an approved variation is what the registry
   * gets. A draft or a rejected one answers 422 — it is not a decision yet.
   */
  @Post("variations/:id/documents")
  @HttpCode(201)
  @NeedsAny(["contractRecords", "WRITE"], ["paymentCertFinance", "APPROVE"])
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File an approved variation with eArchive" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: UPLOAD_BODY })
  @ApiZodResponse(201, DocumentRecord, "The document, queued for eArchive")
  @ApiZodError(400, "No file, or a file name that is not usable")
  @ApiZodError(403, "A role that does not file documents, or a unit the caller may not write")
  @ApiZodError(404, "No such variation, or none the caller may see")
  @ApiZodError(409, "That item is already filed under the same reference")
  @ApiZodError(422, "A variation that is not approved, or a file eArchive does not accept")
  variation(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<DocumentRecord> {
    return this.documents.fileVariation(id, upload(file, body));
  }

  @Get("variations/:id/documents")
  @ApiOperation({ summary: "The documents filed against a variation, newest version first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(DocumentRecord), "The documents, newest version first")
  @ApiZodError(401, "No token, or a token that does not verify")
  variationDocuments(@Param("id") id: string): Promise<DocumentRecord[]> {
    return this.documents.listFor("variation", id);
  }

  /**
   * The bytes of a filed document, for the preview on S17 and S18a: a photo
   * in the strip, anything else in a new tab. No `@Needs`: reading a document
   * follows the row policy like every other document read (ADR-0010), so one
   * in a unit the caller may not read answers 404.
   *
   * `inline` so a photo or a PDF opens in the browser instead of landing in
   * the downloads folder; the name is the Greek title, RFC 5987-encoded.
   * `nosniff` holds the browser to the type eArchive's whitelist allowed at
   * upload. The one type on that whitelist a browser would run is HTML, and
   * the app's proxy serves this from the app's own origin, so an HTML file
   * goes out as an attachment and sandboxed: it is saved, never rendered as
   * part of eCapital.
   */
  @Get("documents/:id/content")
  @ApiOperation({ summary: "The bytes of a filed document, for a preview" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  // The types go on the 200 alone, not through `@ApiProduces`, which would
  // stamp them on the 401 and the 404 too; those are the JSON error body.
  @ApiResponse({
    status: 200,
    description: "The file, with the type it was filed under",
    content: Object.fromEntries(
      MIME_WHITELIST.map((mime) => [mime, { schema: { type: "string", format: "binary" } }]),
    ),
  })
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such document, none the caller may see, or none left in the store")
  async content(
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.content(id);
    const html = file.mime === "text/html";
    response.setHeader("Content-Type", contentType(file.mime));
    response.setHeader(
      "Content-Disposition",
      `${html ? "attachment" : "inline"}; filename*=UTF-8''${rfc5987(file.filename)}`,
    );
    response.setHeader("Content-Length", String(file.bytes.length));
    response.setHeader("Cache-Control", "private, max-age=300");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (html) response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    return new StreamableFile(file.bytes);
  }

}

const UploadFields = z.object({
  titleEl: z.string().min(1).max(500).optional(),
  mime: z.string().min(1).max(120).optional(),
});

/**
 * The browser's `Content-Type` for an upload is a guess and is sometimes
 * `application/octet-stream`, which is not on eArchive's whitelist. A caller
 * may therefore say what the file is; whatever arrives is checked against the
 * whitelist in the store before a byte is written.
 */
function upload(file: Express.Multer.File | undefined, body: unknown): UploadInput {
  if (!file?.buffer?.length) throw AppError.badRequest("errors.documentNeeded");
  const fields = UploadFields.safeParse(body ?? {});
  if (!fields.success) throw AppError.badRequest("errors.badRequest");
  return {
    bytes: file.buffer,
    filename: file.originalname,
    mime: (fields.data.mime ?? file.mimetype ?? "").trim().toLowerCase(),
    titleEl: fields.data.titleEl,
  };
}

/**
 * A text file on the whitelist carries no charset of its own, and a Greek
 * note read as Latin-1 is unreadable. UTF-8 is what eCapital's own exports
 * and every current office tool write.
 */
function contentType(mime: string): string {
  return mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime;
}

/** `encodeURIComponent` leaves `'()*` alone; RFC 5987's attr-char does not. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
