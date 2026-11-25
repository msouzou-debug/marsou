import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import {
  Rfi,
  RfiAnswer,
  RfiCreate,
  RfiDocument,
  RfiUpdate,
  isOnlyFutureDateIssue,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { RolesGuard } from "../common/roles.guard";
import { MAX_FILE_BYTES, MIME_WHITELIST } from "../documents/earchive-contract";
import { Needs } from "../permissions/needs.guard";
import { evidenceMime } from "./rfi-rows";
import { RfisService } from "./rfis.service";

const UPLOAD_BODY = {
  type: "object",
  required: ["file"],
  properties: {
    file: {
      type: "string",
      format: "binary",
      description: "The sent e-mail (.msg, .eml or .pdf) or the reply received.",
    },
    titleEl: {
      type: "string",
      description: "The title on the folder. Left out, the subject line is used.",
    },
    mime: {
      type: "string",
      enum: MIME_WHITELIST.map(String),
      description:
        "Overrides the browser's guess. eArchive's whitelist, nothing else. A .msg or .eml file is filed by its extension whatever this says.",
    },
  },
};

const UploadFields = z.object({
  // The `document` row holds 3 to 500 characters (0014); a shorter title is
  // the caller's mistake, not the database's.
  titleEl: z.string().trim().min(3).max(500).optional(),
  mime: z.string().min(1).max(120).optional(),
});

/**
 * The sentence a refused RFI body gets: the recipient and the address have
 * their own, a sent day after today is the site log's `errors.dateInFuture`,
 * and anything else is the route's general one.
 */
function bodyError(error: z.ZodError, fallback: string): AppError {
  if (isOnlyFutureDateIssue(error)) return AppError.badRequest("errors.dateInFuture");
  const field = error.issues[0]?.path[0];
  if (field === "recipientName") return AppError.badRequest("errors.rfiRecipientNeeded");
  if (field === "recipientEmail") return AppError.badRequest("errors.rfiRecipientEmailNotValid");
  return AppError.badRequest(fallback);
}

/**
 * M1 — the RFI log (R09). Αίτημα διευκρίνισης.
 *
 * The routes sit under `/contracts/:id/rfis` because that is how an RFI is
 * read: it is a question about one contract's works and it has no life apart
 * from it.
 *
 * Nothing here decides who may see an RFI; the row policies do (ADR-0010).
 * Nothing here decides who may answer one either — unlike a variation, an RFI
 * has no approver, because answering a question is not a decision about money
 * (ADR-0017).
 *
 * Owner decision 25/11/2026: eCapital sends no e-mail. An RFI records who it
 * was sent to and when, and the engineer files the sent message (and the
 * reply) as evidence through `POST …/rfis/:rid/documents`.
 */
@ApiTags("site log")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class RfisController {
  constructor(private readonly rfis: RfisService) {}

  @Get("contracts/:id/rfis")
  @ApiOperation({ summary: "The RFIs on one contract, newest first, with their SLA band" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(Rfi), "The contract's RFIs, newest number first")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  list(@Param("id") id: string): Promise<Rfi[]> {
    return this.rfis.list(id, new Date());
  }

  @Post("contracts/:id/rfis")
  @HttpCode(201)
  @ApiOperation({ summary: "Raise an RFI on the contract; the API sets the SLA clock" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(RfiCreate) as never })
  @ApiZodResponse(201, Rfi, "The RFI as stored, OPEN, raised by the caller, numbered per contract")
  @ApiZodError(400, "The body is not a valid RFI: no question, no recipient, a bad address or a sent day after today")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "The sent day is before the day the RFI is raised")
  create(@Param("id") id: string, @Body() body: unknown): Promise<Rfi> {
    const parsed = RfiCreate.safeParse(body);
    if (!parsed.success) throw bodyError(parsed.error, "errors.rfiNotValid");
    return this.rfis.create(id, parsed.data, new Date());
  }

  /**
   * UAT 25/11/2026: the same write as raising one (the rfisInstructions row,
   * enforced by the row policy, ADR-0010). Refused on a CLOSED RFI and for a
   * due date or a sent day before the day it was raised; see the service.
   */
  @Patch("contracts/:id/rfis/:rid")
  @ApiOperation({
    summary: "Correct an RFI's question, due date, recipient or sent day while it is not closed",
  })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(RfiUpdate) as never })
  @ApiZodResponse(200, Rfi, "The RFI after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or RFI")
  @ApiZodError(422, "The RFI is closed, or the due date or sent day is before the day it was raised")
  update(
    @Param("id") id: string,
    @Param("rid") rid: string,
    @Body() body: unknown,
  ): Promise<Rfi> {
    const parsed = RfiUpdate.safeParse(body);
    if (!parsed.success) throw bodyError(parsed.error, "errors.rfiUpdateNotValid");
    return this.rfis.update(id, rid, sentKeysOnly(parsed.data, body), new Date());
  }

  /** RULE (ADR-0017): the answerer may be the raiser; see the service. */
  @Post("contracts/:id/rfis/:rid/answer")
  @HttpCode(200)
  @ApiOperation({ summary: "Answer an open RFI" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(RfiAnswer) as never })
  @ApiZodResponse(200, Rfi, "The RFI, now ANSWERED, with the answer and who gave it")
  @ApiZodError(400, "The body carries no answer")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or RFI")
  @ApiZodError(422, "The RFI has already been answered")
  answer(
    @Param("id") id: string,
    @Param("rid") rid: string,
    @Body() body: unknown,
  ): Promise<Rfi> {
    const parsed = RfiAnswer.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.rfiAnswerNotValid");
    return this.rfis.answer(id, rid, parsed.data, new Date());
  }

  @Post("contracts/:id/rfis/:rid/close")
  @HttpCode(200)
  @ApiOperation({ summary: "Close an answered RFI" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, Rfi, "The RFI, now CLOSED")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or RFI")
  @ApiZodError(422, "The RFI has not been answered yet, or is closed already")
  close(@Param("id") id: string, @Param("rid") rid: string): Promise<Rfi> {
    return this.rfis.close(id, rid, new Date());
  }

  // ---------------------------------------- evidence (owner, 25/11/2026) --

  /** The bytes are `GET /documents/:id/content`, like every other paper. */
  @Get("contracts/:id/rfis/:rid/documents")
  @ApiOperation({ summary: "The sent e-mails and replies filed against an RFI, newest first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(RfiDocument), "The RFI's papers, newest first")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract or RFI, or none the caller may see")
  documents(@Param("id") id: string, @Param("rid") rid: string): Promise<RfiDocument[]> {
    return this.rfis.documents(id, rid);
  }

  /**
   * The same shape as every other document route: multipart, one MAIN file,
   * the `document` row and the `dms_outbox` item in one transaction
   * (ADR-0023). Asked of the matrix before a byte is stored: whoever writes
   * the RFI log files its evidence, and the row policy says the same
   * (0030 `document_insert_rfi`).
   */
  @Post("contracts/:id/rfis/:rid/documents")
  @HttpCode(201)
  @Needs("rfisInstructions", "WRITE")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File the sent e-mail, or the reply, against an RFI" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "rid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: UPLOAD_BODY })
  @ApiZodResponse(201, RfiDocument, "The paper, filed against the RFI and queued for eArchive")
  @ApiZodError(400, "No file, a title under 3 characters, or a file name that is not usable")
  @ApiZodError(403, "A role that does not write RFIs, or a unit the caller may not write")
  @ApiZodError(404, "No such contract or RFI, or none the caller may see")
  @ApiZodError(422, "A file type eArchive does not accept, or one over 50 MB")
  addDocument(
    @Param("id") id: string,
    @Param("rid") rid: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<RfiDocument> {
    if (!file?.buffer?.length) throw AppError.badRequest("errors.documentNeeded");
    const fields = UploadFields.safeParse(body ?? {});
    if (!fields.success) throw AppError.badRequest("errors.badRequest");
    return this.rfis.addDocument(id, rid, {
      bytes: file.buffer,
      filename: file.originalname,
      mime: evidenceMime(file.originalname, fields.data.mime ?? file.mimetype ?? ""),
      titleEl: fields.data.titleEl,
    });
  }
}
