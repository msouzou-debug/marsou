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
  BacklogCreate,
  BacklogItem,
  WorkOrder,
  WorkOrderCreate,
  WorkOrderDetail,
  WorkOrderEvent,
  WorkOrderListQuery,
  WorkOrderListRow,
  WorkOrderPatch,
  WorkOrderStatus,
  WorkOrderTransition,
} from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { sentKeysOnly } from "../common/patch";
import { Roles, RolesGuard } from "../common/roles.guard";
import { MAX_FILE_BYTES, MIME_WHITELIST } from "../documents/earchive-contract";
import { WorkOrdersService } from "./work-orders.service";

/**
 * A filter that may be repeated (`?status=OPEN&status=PAUSED`) or written
 * once with commas (`?status=OPEN,PAUSED`) comes back as one array.
 */
export const manyOf = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) =>
      value === undefined || value === ""
        ? undefined
        : (Array.isArray(value) ? value : [value])
            .flatMap((part) => String(part).split(","))
            .map((part) => part.trim())
            .filter(Boolean),
    z.array(item).optional(),
  );

export const booleanParam = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

/** A query string carries strings; the contract's numbers and arrays are coerced once. */
const ListQuery = WorkOrderListQuery.extend({
  status: manyOf(WorkOrderStatus),
  mine: booleanParam,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const WorkOrderList = z.object({ items: z.array(WorkOrderListRow), total: z.number().int() });
type WorkOrderList = z.infer<typeof WorkOrderList>;

const NoteBody = z.object({ noteEl: z.string().trim().min(1).max(4000) });

/** R35 from the order: the asset, the line and the title default from it. */
const OrderBacklogBody = BacklogCreate.omit({ orgUnitId: true, sourceWorkOrderId: true }).extend({
  titleEl: z.string().min(3).max(200).optional(),
});

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

const UploadFields = z.object({
  titleEl: z.string().min(1).max(500).optional(),
  mime: z.string().min(1).max(120).optional(),
});

/**
 * M5 — Εντολές εργασίας (R33, R34, R36; ADR-0031).
 *
 * Two lists of roles, because the contract has two kinds of person: whoever
 * notices a fault may raise the call — the clinical approver included,
 * because the nursing team is who notices (owner answer, 06/10/2026) — and
 * only the estate's people may work it. Both are row policies first
 * (`can_raise_work_order`, `can_work_work_order`); the `@Roles` below are the
 * second lock.
 *
 * The paths are a contract with the web app. None of them is renamed.
 */
@ApiTags("work orders")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("work-orders")
export class WorkOrdersController {
  constructor(private readonly orders: WorkOrdersService) {}

  @Get()
  @ApiOperation({ summary: "The work orders the caller may see, filtered, sorted and paged" })
  @ApiQuery({ name: "orgUnitId", required: false })
  @ApiQuery({ name: "kind", required: false })
  @ApiQuery({ name: "status", required: false, description: "Repeated or comma-separated" })
  @ApiQuery({ name: "band", required: false })
  @ApiQuery({ name: "slaState", required: false, description: "At least one timer in this state" })
  @ApiQuery({ name: "assetId", required: false })
  @ApiQuery({ name: "slaSystemId", required: false })
  @ApiQuery({ name: "maintenanceContractId", required: false })
  @ApiQuery({ name: "mine", required: false, schema: { type: "boolean" } })
  @ApiQuery({ name: "from", required: false, description: "calledAt from (ISO date)" })
  @ApiQuery({ name: "to", required: false, description: "calledAt before (ISO date)" })
  @ApiQuery({ name: "q", required: false, description: "Reference, title, asset tag or name" })
  @ApiQuery({ name: "sort", required: false })
  @ApiQuery({ name: "dir", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "pageSize", required: false })
  @ApiZodResponse(200, WorkOrderList, "The page, with the three timers on every row")
  @ApiZodError(400, "The filters, the sort or the page are not usable")
  @ApiZodError(401, "No token, or a token that does not verify")
  list(@Query() query: unknown): Promise<WorkOrderList> {
    const parsed = ListQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.workOrderQueryNotValid");
    return this.orders.list(parsed.data);
  }

  @Get(":id")
  @ApiOperation({ summary: "One work order with its story, its checklist and its repeat count" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, WorkOrderDetail, "The order and every step taken on it")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No such order, or none the caller may see")
  detail(@Param("id") id: string): Promise<WorkOrderDetail> {
    return this.orders.detail(id);
  }

  /** S20, the call. The three deadlines are stamped from `calledAt` (ADR-0031 §3). */
  @Post()
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer", "technician", "clinical_approver")
  @ApiOperation({ summary: "Raise a call; the timers start from the moment it was sent" })
  @ApiBody({ schema: jsonSchema(WorkOrderCreate) as never })
  @ApiZodResponse(201, WorkOrder, "The order as stored, with its reference and deadlines")
  @ApiZodError(400, "Not a valid call, no unit, or an asset and unit that disagree")
  @ApiZodError(403, "A role that does not raise calls, or a unit the caller may not write")
  @ApiZodError(404, "An asset, catalogue line or room that is not this caller's")
  create(@Body() body: unknown): Promise<WorkOrder> {
    const parsed = WorkOrderCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.workOrderNotValid");
    return this.orders.create(parsed.data);
  }

  @Patch(":id")
  @Roles("admin", "estates_head", "project_engineer", "technician")
  @ApiOperation({ summary: "Change an order: details, codes, costs or the restore extension" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(WorkOrderPatch) as never })
  @ApiZodResponse(200, WorkOrder, "The order after the change")
  @ApiZodError(400, "Not a valid change")
  @ApiZodError(403, "A role that does not work orders, or a unit the caller may not write")
  @ApiZodError(404, "No such order, or an asset, line or room that is not this caller's")
  @ApiZodError(422, "An extension with no reason, or codes cleared on a completed order")
  update(@Param("id") id: string, @Body() body: unknown): Promise<WorkOrder> {
    const parsed = WorkOrderPatch.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.workOrderNotValid");
    return this.orders.update(id, sentKeysOnly(parsed.data, body));
  }

  /** S19's buttons. The API refuses a step out of order (WORK_ORDER_TRANSITIONS). */
  @Post(":id/transition")
  @HttpCode(200)
  @Roles("admin", "estates_head", "project_engineer", "technician")
  @ApiOperation({ summary: "Take the next step: acknowledge, start, pause, resume, restore, complete, cancel" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(WorkOrderTransition) as never })
  @ApiZodResponse(200, WorkOrderDetail, "The order after the step, with its story")
  @ApiZodError(400, "Not a valid step, or a time before the call or in the future")
  @ApiZodError(403, "A role that does not work orders, or a unit the caller may not write")
  @ApiZodError(404, "No such order, or none the caller may see")
  @ApiZodError(409, "That step is not the next one from where the order is")
  @ApiZodError(422, "A corrective order completed uncoded, or a cancellation with no reason")
  transition(@Param("id") id: string, @Body() body: unknown): Promise<WorkOrderDetail> {
    const parsed = WorkOrderTransition.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.workOrderNotValid");
    return this.orders.transition(id, parsed.data);
  }

  @Post(":id/notes")
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer", "technician", "clinical_approver")
  @ApiOperation({ summary: "Add a note to the order's story" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(NoteBody) as never })
  @ApiZodResponse(201, WorkOrderEvent, "The note, as a line of the story")
  @ApiZodError(400, "An empty note")
  @ApiZodError(403, "A role that does not raise calls, or a unit the caller may not write")
  @ApiZodError(404, "No such order, or none the caller may see")
  note(@Param("id") id: string, @Body() body: unknown): Promise<WorkOrderEvent> {
    const parsed = NoteBody.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.workOrderNoteNotValid");
    return this.orders.addNote(id, parsed.data.noteEl);
  }

  /**
   * ADR-0031 §11: a photograph or the contractor's report, filed with
   * eArchive through the outbox like every other document, and a PHOTO line
   * in the story pointing at it.
   */
  @Post(":id/documents")
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer", "technician")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File a photograph or the contractor's report on the order" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: UPLOAD_BODY })
  @ApiZodResponse(201, WorkOrderEvent, "The PHOTO line, pointing at the queued document")
  @ApiZodError(400, "No file, or a file name that is not usable")
  @ApiZodError(403, "A role that does not work orders, or a unit the caller may not write")
  @ApiZodError(404, "No such order, or none the caller may see")
  @ApiZodError(422, "A file type eArchive does not accept, or one over 50 MB")
  document(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<WorkOrderEvent> {
    if (!file?.buffer?.length) throw AppError.badRequest("errors.documentNeeded");
    const fields = UploadFields.safeParse(body ?? {});
    if (!fields.success) throw AppError.badRequest("errors.workOrderNotValid");
    return this.orders.addDocument(id, {
      bytes: file.buffer,
      filename: file.originalname,
      mime: (fields.data.mime ?? file.mimetype ?? "").trim().toLowerCase(),
      titleEl: fields.data.titleEl,
    });
  }

  /** R35 from the order: work the agreement will not absorb. */
  @Post(":id/backlog")
  @HttpCode(201)
  @Roles("admin", "estates_head", "project_engineer")
  @ApiOperation({ summary: "Send the work to the maintenance backlog" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: jsonSchema(OrderBacklogBody) as never })
  @ApiZodResponse(201, BacklogItem, "The backlog item, linked back to the order")
  @ApiZodError(400, "Not a valid backlog item")
  @ApiZodError(403, "A role that does not keep the backlog, or a unit the caller may not write")
  @ApiZodError(404, "No such order, or none the caller may see")
  toBacklog(@Param("id") id: string, @Body() body: unknown): Promise<BacklogItem> {
    const parsed = OrderBacklogBody.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.backlogItemNotValid");
    return this.orders.toBacklog(id, parsed.data);
  }
}
