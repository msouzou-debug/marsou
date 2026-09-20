/**
 * `POST /api/v1/dms/events` — what eArchive tells eCapital afterwards.
 *
 * Three events: a protocol deleted, a legal hold set, a legal hold cleared.
 * eArchive calls this over the loopback on port 5015, with the same bearer
 * token eCapital uses to call it.
 *
 * Four rules, in the order they are checked:
 *
 *   1. **Loopback only.** A request carrying `X-Forwarded-For`, `X-Real-IP`,
 *      `Forwarded`, `CF-Connecting-IP` or `CF-Ray` is refused `403
 *      LOOPBACK_ONLY`. ADR-0022 wrote that rule for eFinance's side of a
 *      loopback contract; it points inwards here for exactly the same reason.
 *      A call from eArchive on the same host has no reason to carry one, and
 *      one that does either came through something it should not have or is
 *      trying to look like it came from somewhere it did not.
 *   2. **The token.** Missing, malformed or wrong is `401`, compared in
 *      constant time so the answer does not leak the token a byte at a time.
 *   3. **Idempotent.** The same event twice is `200` both times: the unique
 *      index on (event, protocol_id, at) is what decides, not the controller.
 *   4. **Quickly.** Nothing here calls anything else; the whole handler is
 *      one function call into the database.
 *
 * This route is `@Public`: the caller is eArchive, not a person in the
 * directory, so there is no session to open and no `app.user_id` to put on a
 * transaction. It therefore writes through `ecapital.dms_record_event`, which
 * is SECURITY DEFINER, and the audit trigger records the change with no
 * actor — which is the truth about who made it.
 */
import { Controller, Headers, HttpCode, Inject, Logger, Post, Req, Body } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { Public } from "../auth/public.decorator";
import { CONFIG, type AppConfig } from "../config";
import { DmsEventAck, DmsEventBody, DmsEventKind } from "./dms-contracts";
import { DmsEventsService } from "./dms-events.service";
import { FORWARDED_HEADERS } from "./earchive-contract";

@ApiTags("documents")
@Controller("api/v1/dms")
export class DmsEventsController {
  private readonly logger = new Logger(DmsEventsController.name);
  constructor(
    private readonly events: DmsEventsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("events")
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: "eArchive tells eCapital a protocol was deleted or put on hold" })
  @ApiBody({ schema: jsonSchema(DmsEventBody) as never })
  @ApiZodResponse(200, DmsEventAck, "Recorded, or already recorded — 200 either way")
  @ApiZodError(400, "A body that is not an event at all (an unknown kind is acknowledged with 200)")
  @ApiZodError(401, "No token, or not the token eArchive was given")
  @ApiZodError(403, "A request carrying a public-edge header; this route is loopback only")
  async receive(
    @Req() request: Request,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<DmsEventAck> {
    this.refuseForwarded(request);
    this.checkToken(authorization);

    const parsed = DmsEventBody.safeParse(body ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.dmsEventNotValid");
    const at = new Date(parsed.data.at);
    if (Number.isNaN(at.getTime())) throw AppError.badRequest("errors.dmsEventNotValid");

    const kind = DmsEventKind.safeParse(parsed.data.event);
    if (!kind.success) {
      // Acknowledged so eArchive's queue moves on; nothing local changes.
      this.logger.warn(`dms event kind not known to this build, acknowledged: ${parsed.data.event} (${parsed.data.protocol_id})`);
      return { recorded: false, ignored: true };
    }
    const recorded = await this.events.record({ ...parsed.data, event: kind.data, at });
    return { recorded };
  }

  /** ADR-0022's header list, refused rather than ignored. */
  private refuseForwarded(request: Request): void {
    for (const header of FORWARDED_HEADERS) {
      if (request.headers[header] !== undefined) {
        throw AppError.forbidden("errors.dmsLoopbackOnly");
      }
    }
  }

  /**
   * The same token eArchive issued eCapital for the ingest side. With none
   * configured nothing is accepted: an open callback that writes legal holds
   * is worse than one that is not there yet.
   */
  private checkToken(authorization: string | undefined): void {
    const expected = this.config.ECAPITAL_INGEST_TOKEN ?? "";
    if (!expected) throw AppError.unauthorized("errors.dmsTokenNotAccepted");
    const offered = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]?.trim() ?? "";
    if (!offered || !constantTimeEqual(offered, expected)) {
      throw AppError.unauthorized("errors.dmsTokenNotAccepted");
    }
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual refuses different lengths, and a length difference is
  // already visible from the outside, so it is compared first and separately.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
