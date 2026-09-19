import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
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
  @Roles("admin", "estates_head", "project_engineer", "finance")
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
  @Roles("admin", "estates_head", "project_engineer", "finance")
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
  @Roles("admin", "estates_head", "project_engineer", "finance")
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
