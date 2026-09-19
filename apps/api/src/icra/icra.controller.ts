import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { IcraInput, IcraMatrixCell, IcraMatrixVersion, IcraResult } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse, jsonSchema } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { IcraService } from "./icra.service";

/**
 * A new edition of the matrix: the sixteen cells, an effective date, and a
 * note saying where it came from. `status` is not in the body — a version
 * arrives DRAFT and becomes ACTIVE through the activate route, which is the
 * moment somebody takes responsibility for it (§6.2).
 */
const IcraMatrixVersionCreate = z.object({
  id: z.string().min(3).max(64),
  basedOn: z.string().min(3).max(200),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notesEl: z.string().max(2000).nullable().default(null),
  approvedByName: z.string().max(200).nullable().default(null),
  cells: z.array(IcraMatrixCell).length(16),
});

/**
 * M3 — Εκτίμηση κινδύνου λοιμώξεων (ICRA), R20.
 *
 * CAPEX-01 §6.2: «Ship the matrix as reference data with a version and
 * effective date; ΟΚΥπΥ Infection Control approves the local edition and can
 * amend it without a release.» That is what these five routes are — four
 * about the reference data, one that runs the engine over it.
 *
 * Reading the matrix needs no role: the wizard shows the cell and the
 * controls to whoever is filling it in, and the row policy in migration 0015
 * lets any signed-in caller read it. Writing it is an administrator's or the
 * Infection Control officer's, said twice — the role guard here and
 * `ecapital.can_manage_icra_matrix()` in the policy.
 */
@ApiTags("icra")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("icra")
export class IcraController {
  constructor(private readonly icra: IcraService) {}

  @Get("matrix")
  @ApiOperation({ summary: "The ACTIVE ICRA matrix, with all sixteen cells and their controls" })
  @ApiZodResponse(200, IcraMatrixVersion, "The edition in force today")
  @ApiZodError(401, "No token, or a token that does not verify")
  @ApiZodError(404, "No edition has been activated yet")
  matrix(): Promise<IcraMatrixVersion> {
    return this.icra.activeMatrix();
  }

  @Get("matrix/versions")
  @Roles("admin", "clinical_approver")
  @ApiOperation({ summary: "Every edition of the matrix, newest effective date first" })
  @ApiZodResponse(200, z.array(IcraMatrixVersion), "Drafts, the active edition and the retired ones")
  @ApiZodError(403, "A role that does not keep the matrix")
  versions(): Promise<IcraMatrixVersion[]> {
    return this.icra.versions();
  }

  /**
   * RULE (§6.2): a change is a new version, never an edit of a cell. A permit
   * decided under one edition has to keep reading as it was decided.
   */
  @Post("matrix/versions")
  @HttpCode(201)
  @Roles("admin", "clinical_approver")
  @ApiOperation({ summary: "Publish a new DRAFT edition of the matrix" })
  @ApiBody({ schema: jsonSchema(IcraMatrixVersionCreate) as never })
  @ApiZodResponse(201, IcraMatrixVersion, "The edition as stored, DRAFT")
  @ApiZodError(400, "The body is not a valid matrix edition")
  @ApiZodError(403, "Not an administrator and not the Infection Control officer")
  @ApiZodError(409, "An edition with that id already exists")
  @ApiZodError(422, "The edition does not carry all sixteen cells")
  createVersion(@Body() body: unknown): Promise<IcraMatrixVersion> {
    const parsed = IcraMatrixVersionCreate.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.icraMatrixNotValid");
    return this.icra.createVersion(parsed.data);
  }

  @Post("matrix/versions/:id/activate")
  @HttpCode(200)
  @Roles("admin", "clinical_approver")
  @ApiOperation({ summary: "Make this edition the ACTIVE one and retire the edition before it" })
  @ApiParam({ name: "id", schema: { type: "string" } })
  @ApiZodResponse(200, IcraMatrixVersion, "The edition, now ACTIVE and stamped as approved")
  @ApiZodError(403, "Not an administrator and not the Infection Control officer")
  @ApiZodError(404, "No such edition")
  @ApiZodError(422, "The edition is already active, or has been retired")
  activate(@Param("id") id: string): Promise<IcraMatrixVersion> {
    return this.icra.activate(id, new Date());
  }

  /**
   * The wizard's own route (UI S12). It stores nothing: the class it answers
   * with is written down only when `POST /permits/:id/icra` accepts it.
   */
  @Post("evaluate")
  @HttpCode(200)
  @ApiOperation({ summary: "Run the ICRA engine over the ACTIVE matrix; nothing is stored" })
  @ApiBody({ schema: jsonSchema(IcraInput) as never })
  @ApiZodResponse(200, IcraResult, "The class, the controls and the refusal key when there is one")
  @ApiZodError(400, "The body is not a valid ICRA input")
  @ApiZodError(404, "An area the caller cannot see, or no active matrix")
  evaluate(@Body() body: unknown): Promise<IcraResult> {
    const parsed = IcraInput.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("errors.icraInputNotValid");
    return this.icra.evaluate(parsed.data);
  }
}
