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
  SiteInstruction,
  SiteInstructionCreate,
  SiteInstructionDocument,
  SiteInstructionUpdate,
  Variation,
  isOnlyFutureDateIssue,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { RolesGuard } from "../common/roles.guard";
import { MAX_FILE_BYTES, MIME_WHITELIST } from "../documents/earchive-contract";
import { Needs } from "../permissions/needs.guard";
import { evidenceMime } from "../rfis/rfi-rows";
import { SiteInstructionsService } from "./site-instructions.service";

const UPLOAD_BODY = {
  type: "object",
  required: ["file"],
  properties: {
    file: {
      type: "string",
      format: "binary",
      description: "The sent e-mail (.msg, .eml or .pdf), the letter, or the contractor's reply.",
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
  // The `document` row holds 3 to 500 characters (0014).
  titleEl: z.string().trim().min(3).max(500).optional(),
  mime: z.string().min(1).max(120).optional(),
});

/**
 * The sentence a refused instruction body gets: a day after today is the
 * site log's `errors.dateInFuture`, the recipient and the address have their
 * own (owner request 26/11/2026), anything else is the route's general one.
 */
function bodyError(error: z.ZodError): AppError {
  if (isOnlyFutureDateIssue(error)) return AppError.badRequest("errors.dateInFuture");
  const field = error.issues[0]?.path[0];
  if (field === "recipientName") return AppError.badRequest("errors.siteInstructionRecipientNotValid");
  if (field === "recipientEmail") {
    return AppError.badRequest("errors.siteInstructionRecipientEmailNotValid");
  }
  return AppError.badRequest("errors.siteInstructionNotValid");
}

/**
 * M1 — the site instruction log (R09). Οδηγία εργοταξίου.
 *
 * Like the RFI log, these hang off one contract and have no life apart from
 * it. The one rule the routes carry is the link to a variation, and it is a
 * decision about money rather than an access rule, so it lives in the service
 * and in the database rather than in a role check (ADR-0017).
 *
 * Owner request 26/11/2026: the same e-mail facility as an RFI. eCapital
 * sends no e-mail; an instruction records who it was sent to and when, and
 * the engineer files the sent message or the letter through
 * `POST …/site-instructions/:sid/documents`.
 */
@ApiTags("site log")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class SiteInstructionsController {
  constructor(private readonly instructions: SiteInstructionsService) {}

  @Get("contracts/:id/site-instructions")
  @ApiOperation({ summary: "The site instructions on one contract, newest first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(SiteInstruction), "The contract's instructions, newest number first")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract, or none the caller may see")
  list(@Param("id") id: string): Promise<SiteInstruction[]> {
    return this.instructions.list(id);
  }

  @Post("contracts/:id/site-instructions")
  @HttpCode(201)
  @ApiOperation({ summary: "Issue a site instruction; the API numbers it" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SiteInstructionCreate) as never })
  @ApiZodResponse(201, SiteInstruction, "The instruction as stored, issued by the caller")
  @ApiZodError(400, "The body is not a valid instruction, a bad address, or an issue or sent day after today")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract, or none the caller may see")
  @ApiZodError(422, "The sent day is before the day the instruction was issued")
  create(@Param("id") id: string, @Body() body: unknown): Promise<SiteInstruction> {
    const parsed = SiteInstructionCreate.safeParse(body);
    if (!parsed.success) throw bodyError(parsed.error);
    return this.instructions.create(id, parsed.data);
  }

  /**
   * UAT 25/11/2026: the same write as issuing one (the rfisInstructions row,
   * enforced by the row policy, ADR-0010). Refused once the instruction has a
   * variation; see the service.
   */
  @Patch("contracts/:id/site-instructions/:sid")
  @ApiOperation({ summary: "Correct a site instruction that has not become a variation" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "sid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(SiteInstructionUpdate) as never })
  @ApiZodResponse(200, SiteInstruction, "The instruction after the change")
  @ApiZodError(400, "The body is not a valid change, a bad address, or an issue or sent day after today")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or instruction")
  @ApiZodError(422, "The instruction has already been turned into a variation, or the sent day is before the issue day")
  update(
    @Param("id") id: string,
    @Param("sid") sid: string,
    @Body() body: unknown,
  ): Promise<SiteInstruction> {
    const parsed = SiteInstructionUpdate.safeParse(body);
    if (!parsed.success) throw bodyError(parsed.error);
    return this.instructions.update(id, sid, sentKeysOnly(parsed.data, body));
  }

  /**
   * RULE (R09): only an instruction with cost impact (422 errors.noCostImpact
   * otherwise), and only once (422 errors.alreadyLinked).
   */
  @Post("contracts/:id/site-instructions/:sid/variation")
  @HttpCode(201)
  @ApiOperation({ summary: "Turn a cost-impact instruction into a draft variation" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "sid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(201, Variation, "The new variation, DRAFT, priced at zero for the engineer")
  @ApiZodError(403, "A read-only account, or a role that does not run projects")
  @ApiZodError(404, "No such contract or instruction")
  @ApiZodError(422, "The instruction carries no cost impact, or already has a variation")
  createVariation(@Param("id") id: string, @Param("sid") sid: string): Promise<Variation> {
    return this.instructions.createVariation(id, sid);
  }

  // ------------------------------ correspondence (owner, 26/11/2026) --

  /** The bytes are `GET /documents/:id/content`, like every other paper. */
  @Get("contracts/:id/site-instructions/:sid/documents")
  @ApiOperation({ summary: "The sent e-mails and letters filed against a site instruction, newest first" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "sid", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, z.array(SiteInstructionDocument), "The instruction's papers, newest first")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such contract or instruction, or none the caller may see")
  documents(@Param("id") id: string, @Param("sid") sid: string): Promise<SiteInstructionDocument[]> {
    return this.instructions.documents(id, sid);
  }

  /**
   * The RFI's shape (ADR-0023): multipart, one MAIN file, the `document` row
   * and the `dms_outbox` item in one transaction. Asked of the matrix before
   * a byte is stored; the row policy says the same (0034
   * `document_insert_site_instruction`).
   */
  @Post("contracts/:id/site-instructions/:sid/documents")
  @HttpCode(201)
  @Needs("rfisInstructions", "WRITE")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 }, defParamCharset: "utf8" }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File the sent e-mail, the letter or the reply against a site instruction" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "sid", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: UPLOAD_BODY })
  @ApiZodResponse(201, SiteInstructionDocument, "The paper, filed against the instruction and queued for eArchive")
  @ApiZodError(400, "No file, a title under 3 characters, or a file name that is not usable")
  @ApiZodError(403, "A role that does not write site instructions, or a unit the caller may not write")
  @ApiZodError(404, "No such contract or instruction, or none the caller may see")
  @ApiZodError(422, "A file type eArchive does not accept, or one over 50 MB")
  addDocument(
    @Param("id") id: string,
    @Param("sid") sid: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<SiteInstructionDocument> {
    if (!file?.buffer?.length) throw AppError.badRequest("errors.documentNeeded");
    const fields = UploadFields.safeParse(body ?? {});
    if (!fields.success) throw AppError.badRequest("errors.badRequest");
    return this.instructions.addDocument(id, sid, {
      bytes: file.buffer,
      filename: file.originalname,
      mime: evidenceMime(file.originalname, fields.data.mime ?? file.mimetype ?? ""),
      titleEl: fields.data.titleEl,
    });
  }
}
