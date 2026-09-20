import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import {
  Asset,
  AssetDetail,
  AssetDocument,
  AssetDocumentKind,
  AssetListQuery,
  AssetListRow,
  AssetReading,
  AssetWrite,
  Condition,
  QrLabel,
  ReplacementForecastRow,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { Roles, RolesGuard } from "../common/roles.guard";
import { MAX_FILE_BYTES, MIME_WHITELIST } from "../documents/earchive-contract";
import type { AssetDocumentKindKey } from "../documents/dms-meta";
import { AssetsService } from "./assets.service";

/** A query string carries strings; the contract's numbers are coerced once. */
const ListQuery = AssetListQuery.extend({
  criticality: z.coerce.number().int().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const AssetList = z.object({
  items: z.array(AssetListRow),
  total: z.number().int(),
});
type AssetList = z.infer<typeof AssetList>;

/**
 * R29: the technician records the band and, when the assessment was not made
 * at the moment they typed it, the day it was. `noteEl` is accepted and not
 * stored — see the service for why.
 */
const ConditionBody = z.object({
  condition: Condition,
  assessedAt: z.string().datetime().optional(),
  noteEl: z.string().max(2000).optional(),
});

/** `AssetReading` minus the two the server owns: the id and who took it. */
const ReadingBody = AssetReading.omit({ id: true, takenByName: true }).partial({
  assetId: true,
  takenAt: true,
  unit: true,
});

const LabelsQuery = z.object({
  ids: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
});

const ForecastQuery = z.object({
  from: z.coerce.number().int().min(1900).max(2200),
  to: z.coerce.number().int().min(1900).max(2200),
  orgUnitId: z.string().min(1).optional(),
});

const UPLOAD_BODY = {
  type: "object",
  required: ["file", "kind"],
  properties: {
    file: { type: "string", format: "binary" },
    kind: { type: "string", enum: AssetDocumentKind.options },
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

const UploadFields = z.object({
  kind: AssetDocumentKind,
  titleEl: z.string().min(1).max(500).optional(),
  mime: z.string().min(1).max(120).optional(),
});

/**
 * M4 — Πάγια, the asset register (R26–R30, R45).
 *
 * Nothing here decides who may see or write an asset. The row policies do
 * (ADR-0010): an asset in a unit the caller may not read answers 404, and a
 * write they may not make answers 403. The `@Roles` decorators below are the
 * second lock on the routes that are nobody's business but the estate's —
 * they say «this route is not for you» before a query runs, which is what
 * keeps an auditor's mistaken POST out of the log as a 403 rather than as a
 * policy refusal (CAPEX-01 §10).
 *
 * The paths are a contract with the web app. None of them is renamed.
 */
@ApiTags("assets")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOperation({ summary: "The assets the caller may see, filtered, sorted and paged" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiQuery({ name: "areaId", required: false })
  @ApiQuery({ name: "assetClass", required: false })
  @ApiQuery({ name: "criticality", required: false, description: "1 to 5; 1 is life-critical." })
  @ApiQuery({ name: "condition", required: false, description: "A to E; A is as new." })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "q", required: false, description: "Tag, name, serial or SAP asset number." })
  @ApiQuery({ name: "sort", required: false })
  @ApiQuery({ name: "dir", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiZodResponse(200, AssetList, "The page, with the priority rank on every row")
  @ApiZodError(400, "The filters, the sort or the page are not usable")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(@Query() query: unknown): Promise<AssetList> {
    const parsed = ListQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.assetQueryNotValid");
    return this.assets.list(parsed.data);
  }

  /**
   * R29. Declared before `:id` so that `/assets/labels` is a sheet of labels
   * and not an asset whose id happens to read "labels".
   */
  @Get("labels")
  @ApiOperation({ summary: "QR label data for a set of assets, in the order asked for" })
  @ApiQuery({ name: "ids", required: true, description: "Comma-separated asset ids" })
  @ApiZodResponse(200, z.array(QrLabel), "One label per asset the caller may see")
  @ApiZodError(400, "The query names no asset")
  @ApiZodError(401, "No token, or a token that does not verify")
  labels(@Query() query: unknown): Promise<QrLabel[]> {
    const parsed = LabelsQuery.safeParse(query ?? {});
    if (!parsed.success || !parsed.data.ids.length) {
      throw AppError.badRequest("errors.assetLabelsNeedIds");
    }
    return this.assets.labels(parsed.data.ids);
  }

  /** R30, lean: the sum of `replacementCostEst` by unit and year. */
  @Get("replacement-forecast")
  @ApiOperation({ summary: "What replacing the estate is estimated at, by unit and year" })
  @ApiQuery({ name: "from", required: true, description: "First year, e.g. 2027" })
  @ApiQuery({ name: "to", required: true, description: "Last year, e.g. 2035" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiZodResponse(200, z.array(ReplacementForecastRow), "One row per unit per year with assets due")
  @ApiZodError(400, "The years are missing, not years, or the wrong way round")
  @ApiZodError(401, "No token, or a token that does not verify")
  forecast(@Query() query: unknown): Promise<ReplacementForecastRow[]> {
    const parsed = ForecastQuery.safeParse(query ?? {});
    if (!parsed.success || parsed.data.to < parsed.data.from) {
      throw AppError.badRequest("errors.assetForecastRangeNotValid");
    }
    return this.assets.replacementForecast(
      parsed.data.from,
      parsed.data.to,
      parsed.data.orgUnitId ?? null,
    );
  }

  /**
   * R29 and the M4 definition of done: the scan route. The QR label carries
   * `<APP_ORIGIN>/a/<tag>`, the web app resolves the tag through here, and
   * what comes back is the whole history.
   */
  @Get("by-tag/:tag")
  @ApiOperation({ summary: "One asset by the tag on its label, with its full history" })
  @ApiParam({ name: "tag", schema: { type: "string" }, description: "For example NGH-HVA-0001" })
  @ApiZodResponse(200, AssetDetail, "The asset, its papers, its readings and its history")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No asset carries that tag, or none the caller may see")
  byTag(@Param("tag") tag: string): Promise<AssetDetail> {
    return this.assets.byTag(tag);
  }

  @Get(":id")
  @ApiOperation({ summary: "One asset: place, provenance, hierarchy, papers, readings, history" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, AssetDetail, "The asset and everything that ever touched it")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such asset, or none the caller may see")
  detail(@Param("id") id: string): Promise<AssetDetail> {
    return this.assets.detail(id);
  }

  @Post()
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Record an asset; the database allocates its tag" })
  @ApiBody({ schema: jsonSchema(AssetWrite) as never })
  @ApiZodResponse(201, Asset, "The asset as stored, with the tag it was given")
  @ApiZodError(400, "The body is not a valid asset")
  @ApiZodError(403, "A read-only account, or a unit the caller may not write to")
  @ApiZodError(404, "A unit, area, parent, project or contract that is not this caller's")
  create(@Body() body: unknown): Promise<Asset> {
    const parsed = AssetWrite.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.assetNotValid");
    return this.assets.create(parsed.data);
  }

  /**
   * The unit and the class do not change: both are inside the tag, and the
   * tag is on a sticker on the machine (422, not a silent re-tag).
   */
  @Patch(":id")
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Change an asset; its unit, class and tag do not move" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(AssetWrite.partial()) as never })
  @ApiZodResponse(200, Asset, "The asset after the change")
  @ApiZodError(400, "The body is not a valid change")
  @ApiZodError(403, "A read-only account, or a unit the caller may not write to")
  @ApiZodError(404, "No such asset, or an area, parent, project or contract outside its unit")
  @ApiZodError(422, "An attempt to move the asset's unit or change its class")
  update(@Param("id") id: string, @Body() body: unknown): Promise<Asset> {
    const parsed = AssetWrite.partial().safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.assetNotValid");
    return this.assets.update(id, sentKeysOnly(parsed.data, body));
  }

  /**
   * CAPEX-01 §8: the condition is a field record, so a technician may make
   * it. Audited like every other mutation (R42), and it is the line the
   * history shows as CONDITION.
   */
  @Post(":id/condition")
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer", "technician")
  @ApiOperation({ summary: "Record the physical condition of an asset, band A to E" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ConditionBody) as never })
  @ApiZodResponse(201, Asset, "The asset with its new band and the date it was assessed")
  @ApiZodError(400, "The band is missing or is not one of A to E")
  @ApiZodError(403, "A role that does not assess condition, or a unit the caller may not write to")
  @ApiZodError(404, "No such asset, or none the caller may see")
  condition(@Param("id") id: string, @Body() body: unknown): Promise<Asset> {
    const parsed = ConditionBody.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.assetConditionNotValid");
    return this.assets.recordCondition(id, parsed.data);
  }

  @Post(":id/readings")
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer", "technician")
  @ApiOperation({ summary: "Add a reading — run hours, a temperature, a pressure" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(ReadingBody) as never })
  @ApiZodResponse(201, AssetReading, "The reading as stored, with who took it")
  @ApiZodError(400, "The body is not a valid reading")
  @ApiZodError(403, "A role that does not take readings, or a unit the caller may not write to")
  @ApiZodError(404, "No such asset, or none the caller may see")
  reading(@Param("id") id: string, @Body() body: unknown): Promise<AssetReading> {
    const parsed = ReadingBody.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.assetReadingNotValid");
    return this.assets.addReading(id, parsed.data);
  }

  /**
   * R28. The same shape as the other three document routes: multipart, one
   * MAIN file, the `document` row and the `dms_outbox` item written in one
   * transaction by the DMS service, and the `asset_document` link written
   * beside them (ADR-0023, ADR-0028).
   */
  @Post(":id/documents")
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer", "finance")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File an asset's manual, certificate or commissioning pack" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: UPLOAD_BODY })
  @ApiZodResponse(201, AssetDocument, "The document, linked to the asset and queued for eArchive")
  @ApiZodError(400, "No file, no kind, or a file name that is not usable")
  @ApiZodError(403, "A role that does not file documents, or a unit the caller may not write")
  @ApiZodError(404, "No such asset, or none the caller may see")
  @ApiZodError(409, "That file is already linked to this asset")
  @ApiZodError(422, "A file type eArchive does not accept, or one over 50 MB")
  document(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<AssetDocument> {
    if (!file?.buffer?.length) throw AppError.badRequest("errors.documentNeeded");
    const fields = UploadFields.safeParse(body ?? {});
    if (!fields.success) throw AppError.badRequest("errors.assetDocumentKindNotValid");
    return this.assets.addDocument(id, fields.data.kind as AssetDocumentKindKey, {
      bytes: file.buffer,
      filename: file.originalname,
      mime: (fields.data.mime ?? file.mimetype ?? "").trim().toLowerCase(),
      titleEl: fields.data.titleEl,
    });
  }
}
