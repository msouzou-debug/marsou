import { Injectable } from "@nestjs/common";
import {
  type BoqItem,
  type BoqItemWrite,
  type ContractCreate,
  type ContractDetail,
  type ContractList,
  type ContractListQuery,
  type ContractLookup,
  type ContractUpdate,
  type Defect,
  type ProjectPhase,
  type Variation,
  type VariationCreate,
  type VariationDecision,
} from "@ecapital/shared";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { ContractorsService } from "../contractors/contractors.service";
import { CostWarningsService } from "../cost/cost-warnings.service";
import { type DefectRow, toDefect } from "../defects/defect-rows";
import { phaseIndex } from "../projects/project-rows";
import {
  type BoqRow,
  type ContractRow,
  money,
  toBoqItem,
  toContract,
  warningFacts,
} from "./contract-rows";
import { toWarning } from "./contract-warnings";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RULE (CAPEX-01 §1, R08): a contract starts at award. Everything before it —
 * the tender, the evaluation, the award decision itself — lives in
 * e-Procurement, so a project that has not reached AWARDED has nothing to
 * hang a contract on and the API says so with errors.projectNotAwarded.
 */
const CONTRACT_FROM: ProjectPhase = "AWARDED";

@Injectable()
export class ContractsService {
  constructor(
    private readonly i18n: I18nService,
    private readonly contractors: ContractorsService,
    private readonly costWarnings: CostWarningsService,
  ) {}

  /**
   * As in the project register, there is no permission check in this file and
   * there is not meant to be one (ADR-0010). A contract in a unit the caller
   * may not see does not exist for them: the select returns nothing and the
   * answer is 404. A write they may not make is refused by the policy.
   *
   * The two rules that are not access decisions — R10's segregation and the
   * role that may decide a variation at all — are stated here and on the
   * route, and R10 is stated a third time as a CHECK constraint (ADR-0015).
   */

  async listForProject(projectId: string): Promise<ContractList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.loadProject(projectId);

    const rows = await tx.db
      .select(CONTRACT_COLUMNS)
      .from(schema.contract)
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.contract.contractorId))
      .where(eq(schema.contract.projectId, projectId))
      .orderBy(asc(schema.contract.awardDate), asc(schema.contract.contractNo));

    const items = rows.map((row) => toContract(row as ContractRow));
    return { items, total: items.length };
  }

  /**
   * ADR-0019 — the register across every project the caller may see, for
   * `/contracts` on the web and for anybody arriving from eFinance without a
   * reference. No permission check here either: the row policy is what
   * decides which contracts come back, so a caller sees their own units and
   * nothing else whatever `unit` says (ADR-0010).
   */
  async listAll(query: ContractListQuery): Promise<ContractList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const where = [];
    if (query.unit) where.push(eq(schema.contract.orgUnitId, query.unit));
    if (query.q?.trim()) {
      where.push(matchesListable(query.q.trim()));
    }

    const rows = await tx.db
      .select(CONTRACT_COLUMNS)
      .from(schema.contract)
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.contract.contractorId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.contract.awardDate), asc(schema.contract.ref));

    const items = rows.map((row) => toContract(row as ContractRow));
    return { items, total: items.length };
  }

  /**
   * ADR-0019 — what eFinance's link lands on.
   *
   * eFinance stores a `contract_ref` on an invoice and routes it by prefix:
   * `CON-` opens eMAP, `CAP-` opens eCapital. Both systems answer the same
   * shape of request — `/contracts?q=<ref>` — so the finance clerk's link
   * works without either system knowing anything about the other's ids.
   *
   * It resolves `ref` first and exactly, because that is the reference
   * eFinance was given and it is not ambiguous. Only then does it try
   * `contractNo`, which a person may have typed from the tender papers with
   * different capitals or accents — «ΑΝΑΚΑΙΝΙΣΗ 12/2026» has to find
   * «Ανακαίνιση 12/2026».
   *
   * RULE (ADR-0010): a contract in a unit the caller may not see is not
   * "forbidden", it does not exist — the row policy filters it out and the
   * answer is the same 404 an unknown reference gets.
   */
  async lookup(q: string): Promise<ContractLookup> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const needle = q.trim();
    if (!needle) throw AppError.badRequest("errors.contractRefNeeded");

    const exact = await tx.db
      .select({ id: schema.contract.id })
      .from(schema.contract)
      .where(or(eq(schema.contract.ref, needle), eq(schema.contract.contractNo, needle)))
      .orderBy(asc(schema.contract.ref))
      .limit(1);
    if (exact.length) return { id: exact[0].id };

    const folded = await tx.db
      .select({ id: schema.contract.id })
      .from(schema.contract)
      .where(matchesReference(needle))
      .orderBy(asc(schema.contract.ref))
      .limit(1);
    if (folded.length) return { id: folded[0].id };

    throw AppError.notFound("errors.contractNotFound");
  }

  /**
   * RULE (R08): a blacklisted contractor takes no new contract —
   * errors.contractorBlacklisted, 422. The contracts it already holds run to
   * their end; this refuses the new one only.
   *
   * RULE (CAPEX-01 §1): the project must be AWARDED or later —
   * errors.projectNotAwarded, 422.
   */
  async create(projectId: string, input: ContractCreate): Promise<ContractDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const project = await this.loadProject(projectId);

    if (input.projectId !== projectId) throw AppError.badRequest("errors.contractNotValid");
    if (phaseIndex(project.phase) < phaseIndex(CONTRACT_FROM)) {
      throw AppError.unprocessable("errors.projectNotAwarded", { project: project.titleEl });
    }

    const contractor = await this.contractors.load(input.contractorId);
    if (contractor.blacklisted) {
      throw AppError.unprocessable("errors.contractorBlacklisted", { contractor: contractor.name });
    }
    // RULE (ADR-0025, owner decision 19/09/2026): a budget code that is sent
    // has to be one of eFinance's active CAPEX codes. Null passes through
    // untouched — the shared schema allows it, S07a's own form is what
    // makes it required for a human creating a contract.
    if (input.budgetCode !== null) await this.assertBudgetCode(input.budgetCode);

    // ADR-0019. Allocated inside this request's transaction, by the database,
    // behind an advisory lock on the year — the same pattern ADR-0014 uses
    // for the project code and for the same reason: two people pressing
    // «Αποθήκευση» in the same second must queue, not collide. The year is
    // the award year, so a contract awarded in December 2026 and recorded in
    // January reads CAP-2026-…, which is what the papers say.
    const year = Number(input.awardDate.slice(0, 4));

    try {
      const [row] = await tx.db
        .insert(schema.contract)
        .values({
          projectId,
          // The trigger overwrites this from the project; it is here because
          // the column is NOT NULL.
          orgUnitId: "",
          contractorId: input.contractorId,
          ref: sql`ecapital.allocate_contract_ref(${year})`,
          contractNo: input.contractNo,
          type: input.type,
          awardDate: input.awardDate,
          originalValue: String(input.originalValue),
          // Derived by the trigger. Whatever goes in here is overwritten.
          currentValue: String(input.originalValue),
          startDate: input.startDate,
          completionDate: input.completionDate,
          retentionPct: String(input.retentionPct),
          performanceBondValue:
            input.performanceBondValue === null ? null : String(input.performanceBondValue),
          bondExpiry: input.bondExpiry,
          liquidatedDamagesPerDay:
            input.liquidatedDamagesPerDay === null ? null : String(input.liquidatedDamagesPerDay),
          defectsLiabilityMonths: input.defectsLiabilityMonths,
          sapPoNumber: input.sapPoNumber,
          emapRef: input.emapRef,
          budgetCode: input.budgetCode,
        })
        .returning({ id: schema.contract.id });
      return await this.detail(row.id);
    } catch (error) {
      this.writeError(error, { contractNo: input.contractNo });
    }
  }

  async detail(id: string): Promise<ContractDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const row = await this.load(id);
    const contract = toContract(row);

    const [project] = await tx.db
      .select({
        id: schema.project.id,
        code: schema.project.code,
        titleEl: schema.project.titleEl,
        phase: schema.project.phase,
        unitNameEl: schema.orgUnit.nameEl,
        unitNameEn: schema.orgUnit.nameEn,
      })
      .from(schema.project)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.project.orgUnitId))
      .where(eq(schema.project.id, row.projectId))
      .limit(1);

    const [contractor, boq, variations, defects, rfis, instructionsWithoutVariation, budgetCodeDescriptions] =
      await Promise.all([
        this.contractors.load(row.contractorId),
        this.boqOf(id),
        this.variationsOf(id),
        this.defectsOf(id),
        this.rfiCounts(id),
        this.instructionsWithoutVariation(id),
        this.budgetCodeDescriptions(row.budgetCode),
      ]);

    const approvedVariationsTotal = sumOf(variations, "APPROVED");
    const pendingVariationsTotal = sumOf(variations, "SUBMITTED");
    const variationPctOfOriginal =
      contract.originalValue > 0 ? (approvedVariationsTotal / contract.originalValue) * 100 : 0;

    const facts = warningFacts(
      {
        contractNo: contract.contractNo,
        projectTitleEl: project.titleEl,
        originalValue: contract.originalValue,
        approvedVariationsTotal,
        bondExpiry: contract.bondExpiry,
        completionDate: contract.completionDate,
        extensionDays: contract.extensionDays,
        projectPhase: project.phase,
        instructionsWithoutVariation,
      },
      today(),
    );

    return {
      ...contract,
      project: { id: project.id, code: project.code, titleEl: project.titleEl },
      contractor,
      budgetCodeDescriptionEl: budgetCodeDescriptions.el,
      budgetCodeDescriptionEn: budgetCodeDescriptions.en,
      boq,
      variations,
      approvedVariationsTotal,
      pendingVariationsTotal,
      variationPctOfOriginal,
      warnings: facts.map((fact) =>
        toWarning(this.i18n, fact, { nameEl: project.unitNameEl, nameEn: project.unitNameEn }),
      ),
      // M1 site log (R09, R12): what the contract screen shows under the
      // variations — the snags raised against these works and how the RFI
      // clock is doing. Breached is a count and never a block (CAPEX-01 §1).
      defects,
      rfisOpen: rfis.open,
      rfisBreached: rfis.breached,
    };
  }

  async update(id: string, input: ContractUpdate): Promise<ContractDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(id);

    // RULE (ADR-0025): editable later, by the same roles that edit a
    // contract at all (the row policy). Clearing it (`null`) is allowed;
    // setting it to something needs it to be one of eFinance's active codes.
    if (input.budgetCode !== undefined && input.budgetCode !== null) {
      await this.assertBudgetCode(input.budgetCode);
    }

    const values = pruned({
      contractNo: input.contractNo,
      type: input.type,
      awardDate: input.awardDate,
      startDate: input.startDate,
      completionDate: input.completionDate,
      extensionDays: input.extensionDays,
      retentionPct: input.retentionPct === undefined ? undefined : String(input.retentionPct),
      performanceBondValue:
        input.performanceBondValue === undefined
          ? undefined
          : input.performanceBondValue === null
            ? null
            : String(input.performanceBondValue),
      bondExpiry: input.bondExpiry,
      liquidatedDamagesPerDay:
        input.liquidatedDamagesPerDay === undefined
          ? undefined
          : input.liquidatedDamagesPerDay === null
            ? null
            : String(input.liquidatedDamagesPerDay),
      defectsLiabilityMonths: input.defectsLiabilityMonths,
      sapPoNumber: input.sapPoNumber,
      // RULE (ADR-0019): `emapRef` is editable — somebody types it in after
      // the fact when the eMAP contract is found. `ref` is not, and is not
      // in `ContractUpdate` at all; a trigger refuses it whatever asks.
      emapRef: input.emapRef,
      // ADR-0025: editable later. `null` clears it, a string sets it (already
      // checked above), `undefined` (not sent) leaves it untouched.
      budgetCode: input.budgetCode,
    });
    if (Object.keys(values).length === 0) return this.detail(id);

    try {
      const touched = await tx.db
        .update(schema.contract)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.contract.id, id))
        .returning({ id: schema.contract.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.writeError(error, { contractNo: input.contractNo ?? "" });
    }
    return this.detail(id);
  }

  /**
   * RULE (contract `BoqItemWrite`): the bill of quantities is replaced whole.
   * A bill is a document, not a list of rows people edit one at a time, and
   * an item that vanished from the new one is an item the contract no longer
   * has. The amount of each line is qty × rate, computed by the database.
   */
  async replaceBoq(id: string, items: BoqItemWrite[]): Promise<BoqItem[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(id);

    const numbers = new Set(items.map((item) => item.itemNo));
    if (numbers.size !== items.length) throw AppError.unprocessable("errors.boqItemNoRepeated");

    try {
      await tx.db.delete(schema.boqItem).where(eq(schema.boqItem.contractId, id));
      if (items.length) {
        await tx.db.insert(schema.boqItem).values(
          items.map((item) => ({
            contractId: id,
            orgUnitId: "",
            itemNo: item.itemNo,
            descriptionEl: item.descriptionEl,
            unit: item.unit,
            qty: String(item.qty),
            rate: String(item.rate),
          })),
        );
      }
    } catch (error) {
      this.writeError(error, {});
    }
    return this.boqOf(id);
  }

  // ------------------------------------------------------------ variations --

  /**
   * RULE (R10): a variation is raised by whoever is signed in, starts in
   * DRAFT, and takes the next number on the contract. The number comes from
   * ecapital.allocate_variation_number, which holds an advisory lock on the
   * contract for the length of this transaction, so two engineers raising one
   * in the same second get 4 and 5 rather than two fours (ADR-0015).
   */
  async createVariation(contractId: string, input: VariationCreate): Promise<Variation> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(contractId);
    const caller = await this.callerId();

    try {
      const [{ number }] = await tx.db
        .select({ number: sql<number>`ecapital.allocate_variation_number(${contractId}::uuid)` })
        .from(sql`(select 1) as one`);

      const [row] = await tx.db
        .insert(schema.variation)
        .values({
          contractId,
          orgUnitId: "",
          number,
          descriptionEl: input.descriptionEl,
          reason: input.reason,
          value: String(input.value),
          timeImpactDays: input.timeImpactDays,
          status: "DRAFT",
          raisedBy: caller,
        })
        .returning({ id: schema.variation.id });
      return await this.variation(contractId, row.id);
    } catch (error) {
      this.writeError(error, {});
    }
  }

  /**
   * RULE (R10): a variation is editable while it is the raiser's — in DRAFT,
   * or RETURNED with comments for them to answer. Once it is SUBMITTED it
   * belongs to the approver, and once it is APPROVED or REJECTED it is a
   * decision on the record. An administrator may edit on the raiser's behalf;
   * nobody else can, and errors.notRaiser says so.
   */
  async updateVariation(
    contractId: string,
    variationId: string,
    input: Partial<VariationCreate>,
  ): Promise<Variation> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(contractId);
    const existing = await this.variationRow(contractId, variationId);

    if (existing.status !== "DRAFT" && existing.status !== "RETURNED") {
      throw AppError.unprocessable("errors.variationNotEditable");
    }
    await this.mustBeRaiser(existing.raisedBy, { allowAdmin: true });

    const values = pruned({
      descriptionEl: input.descriptionEl,
      reason: input.reason,
      value: input.value === undefined ? undefined : String(input.value),
      timeImpactDays: input.timeImpactDays,
    });
    if (Object.keys(values).length) {
      const touched = await tx.db
        .update(schema.variation)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.variation.id, variationId))
        .returning({ id: schema.variation.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    }
    return this.variation(contractId, variationId);
  }

  /** RULE (R10): only the raiser sends their own variation for a decision. */
  async submitVariation(contractId: string, variationId: string): Promise<Variation> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(contractId);
    const existing = await this.variationRow(contractId, variationId);

    if (existing.status !== "DRAFT" && existing.status !== "RETURNED") {
      throw AppError.unprocessable("errors.variationNotEditable");
    }
    await this.mustBeRaiser(existing.raisedBy, { allowAdmin: false });

    const touched = await tx.db
      .update(schema.variation)
      .set({ status: "SUBMITTED", updatedAt: sql`now()` })
      .where(eq(schema.variation.id, variationId))
      .returning({ id: schema.variation.id });
    if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    return this.variation(contractId, variationId);
  }

  /**
   * RULE (R10, CAPEX-01 §10): whoever approves a variation is never the
   * person who raised it — errors.sameUserApproval, 403. The route already
   * limits the decision to a head of estates or an administrator, and the
   * CHECK constraint in migration 0003 refuses the row whatever asks for it,
   * so the rule holds for a console session and a repair script too.
   *
   * RULE (R10): sending one back or turning it down needs a reason in
   * writing — errors.commentRequired, 422. Approving one does not; the
   * approval is the comment.
   */
  async decideVariation(
    contractId: string,
    variationId: string,
    input: VariationDecision,
  ): Promise<Variation> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(contractId);
    const existing = await this.variationRow(contractId, variationId);

    if (existing.status !== "SUBMITTED") {
      throw AppError.unprocessable("errors.variationNotSubmitted");
    }
    const comment = input.commentEl?.trim() ?? "";
    if (input.decision !== "APPROVED" && comment === "") {
      throw AppError.unprocessable("errors.commentRequired");
    }

    const caller = await this.callerId();
    if (caller === existing.raisedBy) throw AppError.forbidden("errors.sameUserApproval");

    try {
      const touched = await tx.db
        .update(schema.variation)
        .set({
          status: input.decision,
          decidedBy: caller,
          decidedAt: sql`now()`,
          decisionCommentEl: comment === "" ? null : comment,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.variation.id, variationId))
        .returning({ id: schema.variation.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.writeError(error, {});
    }

    // M2, R31: an approved variation is the only thing that moves a contract's
    // commitment (ADR-0015), so it is also the only decision on this screen
    // that can take a project past its budget line or its 10% ceiling. The
    // five rules are re-run here rather than written a second time.
    const [contract] = await tx.db
      .select({ projectId: schema.contract.projectId })
      .from(schema.contract)
      .where(eq(schema.contract.id, contractId))
      .limit(1);
    if (contract) await this.costWarnings.evaluate(contract.projectId);

    return this.variation(contractId, variationId);
  }

  // ------------------------------------------------------------- internals --

  private async load(id: string): Promise<ContractRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.contractNotFound");
    const rows = await tx.db
      .select(CONTRACT_COLUMNS)
      .from(schema.contract)
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.contract.contractorId))
      .where(eq(schema.contract.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractNotFound");
    return rows[0] as ContractRow;
  }

  private async loadProject(
    id: string,
  ): Promise<{ id: string; titleEl: string; phase: ProjectPhase }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.projectNotFound");
    const rows = await tx.db
      .select({
        id: schema.project.id,
        titleEl: schema.project.titleEl,
        phase: schema.project.phase,
      })
      .from(schema.project)
      .where(eq(schema.project.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.projectNotFound");
    return rows[0];
  }

  /**
   * RULE (ADR-0025, owner decision 19/09/2026): a budget code a contract
   * points at has to be one of eFinance's CAPEX codes and has to be active —
   * a code the sync has since retired is not one to hand out on a new
   * contract, even though a contract already carrying it keeps it
   * (migration 0013's `on delete restrict`, not a cascade).
   */
  private async assertBudgetCode(code: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({ active: schema.budgetCode.active })
      .from(schema.budgetCode)
      .where(eq(schema.budgetCode.code, code))
      .limit(1);
    if (!row || !row.active) throw AppError.badRequest("errors.budgetCodeNotFound", { code });
  }

  /** S07's facts list: both languages, so the screen never machine-translates. */
  private async budgetCodeDescriptions(
    code: string | null,
  ): Promise<{ el: string | null; en: string | null }> {
    if (!code) return { el: null, en: null };
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({
        descriptionEl: schema.budgetCode.descriptionEl,
        descriptionEn: schema.budgetCode.descriptionEn,
      })
      .from(schema.budgetCode)
      .where(eq(schema.budgetCode.code, code))
      .limit(1);
    return { el: row?.descriptionEl ?? null, en: row?.descriptionEn ?? null };
  }

  /** R12: the defects raised against this contract, newest first. */
  private async defectsOf(contractId: string): Promise<Defect[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        id: schema.defect.id,
        orgUnitId: schema.defect.orgUnitId,
        source: schema.defect.source,
        contractId: schema.defect.contractId,
        projectId: schema.defect.projectId,
        areaId: schema.defect.areaId,
        assetId: schema.defect.assetId,
        descriptionEl: schema.defect.descriptionEl,
        photoIds: schema.defect.photoIds,
        estimatedCost: schema.defect.estimatedCost,
        riskBand: schema.defect.riskBand,
        funded: schema.defect.funded,
        targetProjectId: schema.defect.targetProjectId,
        status: schema.defect.status,
        raisedById: schema.defect.raisedBy,
        raisedByName: sql<string | null>`ecapital.user_display_name(${schema.defect.raisedBy})`,
        raisedAt: schema.defect.raisedAt,
        dueDate: schema.defect.dueDate,
        closedAt: schema.defect.closedAt,
        closedById: schema.defect.closedBy,
        closedByName: sql<string | null>`ecapital.user_display_name(${schema.defect.closedBy})`,
      })
      .from(schema.defect)
      .where(eq(schema.defect.contractId, contractId))
      .orderBy(desc(schema.defect.raisedAt));
    return rows.map((row) => toDefect(row as DefectRow));
  }

  /**
   * RULE (R09): an RFI is breached when its due moment has passed and nobody
   * has answered it. Counted in SQL rather than by loading every row, because
   * `BREACHED` needs no threshold arithmetic — it is simply the clock having
   * run out on a question still open.
   */
  private async rfiCounts(contractId: string): Promise<{ open: number; breached: number }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({
        open: sql<number>`count(*) filter (where ${schema.rfi.status} = 'OPEN')::int`,
        breached: sql<number>`count(*) filter (where ${schema.rfi.status} = 'OPEN'
                                                and ${schema.rfi.slaDueAt} <= now())::int`,
      })
      .from(schema.rfi)
      .where(eq(schema.rfi.contractId, contractId));
    return { open: row?.open ?? 0, breached: row?.breached ?? 0 };
  }

  /** R09: cost-impact instructions with no variation behind them yet. */
  private async instructionsWithoutVariation(contractId: string): Promise<number> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.siteInstruction)
      .where(
        and(
          eq(schema.siteInstruction.contractId, contractId),
          eq(schema.siteInstruction.costImpactFlag, true),
          isNull(schema.siteInstruction.variationId),
        ),
      );
    return row?.count ?? 0;
  }

  private async boqOf(contractId: string): Promise<BoqItem[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({
        id: schema.boqItem.id,
        contractId: schema.boqItem.contractId,
        itemNo: schema.boqItem.itemNo,
        descriptionEl: schema.boqItem.descriptionEl,
        unit: schema.boqItem.unit,
        qty: schema.boqItem.qty,
        rate: schema.boqItem.rate,
        amount: schema.boqItem.amount,
      })
      .from(schema.boqItem)
      .where(eq(schema.boqItem.contractId, contractId))
      .orderBy(asc(schema.boqItem.itemNo));
    return rows.map((row) => toBoqItem(row as BoqRow));
  }

  /** Newest first: the last variation raised is the one people are looking for. */
  private async variationsOf(contractId: string): Promise<Variation[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select(VARIATION_COLUMNS)
      .from(schema.variation)
      .where(eq(schema.variation.contractId, contractId))
      .orderBy(desc(schema.variation.number));
    return rows.map(toVariationShape);
  }

  private async variation(contractId: string, variationId: string): Promise<Variation> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select(VARIATION_COLUMNS)
      .from(schema.variation)
      .where(
        and(eq(schema.variation.id, variationId), eq(schema.variation.contractId, contractId)),
      )
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.variationNotFound");
    return toVariationShape(rows[0]);
  }

  private async variationRow(
    contractId: string,
    variationId: string,
  ): Promise<{ id: string; status: Variation["status"]; raisedBy: string }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(variationId)) throw AppError.notFound("errors.variationNotFound");
    const rows = await tx.db
      .select({
        id: schema.variation.id,
        status: schema.variation.status,
        raisedBy: schema.variation.raisedBy,
      })
      .from(schema.variation)
      .where(
        and(eq(schema.variation.id, variationId), eq(schema.variation.contractId, contractId)),
      )
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.variationNotFound");
    return rows[0];
  }

  private async mustBeRaiser(raisedBy: string, options: { allowAdmin: boolean }): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const caller = await this.callerId();
    if (caller === raisedBy) return;
    if (options.allowAdmin && (tx.context.roles ?? []).includes("admin")) return;
    throw AppError.forbidden("errors.notRaiser");
  }

  private async callerId(): Promise<string> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(eq(schema.appUser.subject, tx.context.userId))
      .limit(1);
    // The token verified, so the subject is real; a missing row means the
    // seed and the directory have drifted, which is not the caller's fault.
    if (!rows.length) throw AppError.internal();
    return rows[0].id;
  }

  /** What the database refused, said in the caller's language. */
  private writeError(error: unknown, params: { contractNo?: string }): never {
    if (error instanceof AppError) throw error;
    const state = sqlState(error);
    if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
    if (state === UNIQUE_VIOLATION) {
      throw AppError.unprocessable("errors.contractNoTaken", {
        contractNo: params.contractNo ?? "",
      });
    }
    // The only CHECK a caller can reach on this schema is R10's, and reaching
    // it means the service rule was bypassed somehow. Same sentence either way.
    if (state === CHECK_VIOLATION) throw AppError.forbidden("errors.sameUserApproval");
    throw error;
  }
}

/**
 * One needle against both references and the contractor's name, folded by
 * ecapital.normalise (0002): accents off, capitals down, final sigma
 * regularised. The same function backs the expression index the migration
 * adds on contract_no, so this stays an index scan rather than a table scan
 * once the register is more than a few hundred rows.
 */
function matchesReference(needle: string) {
  const pattern = sql`'%' || ecapital.normalise(${needle}) || '%'`;
  return sql`(
    ecapital.normalise(${schema.contract.ref}) like ${pattern}
    or ecapital.normalise(${schema.contract.contractNo}) like ${pattern}
    or ecapital.normalise(coalesce(${schema.contract.emapRef}, '')) like ${pattern}
  )`;
}

/** The list's own search: the references above, plus who is building it. */
function matchesListable(needle: string) {
  const pattern = sql`'%' || ecapital.normalise(${needle}) || '%'`;
  return sql`(${matchesReference(needle)} or ecapital.normalise(${schema.contractor.name}) like ${pattern})`;
}

const CONTRACT_COLUMNS = {
  id: schema.contract.id,
  projectId: schema.contract.projectId,
  orgUnitId: schema.contract.orgUnitId,
  contractorId: schema.contract.contractorId,
  contractorName: schema.contractor.name,
  ref: schema.contract.ref,
  contractNo: schema.contract.contractNo,
  type: schema.contract.type,
  awardDate: schema.contract.awardDate,
  awardDecisionDocId: schema.contract.awardDecisionDocId,
  originalValue: schema.contract.originalValue,
  currentValue: schema.contract.currentValue,
  currency: schema.contract.currency,
  startDate: schema.contract.startDate,
  completionDate: schema.contract.completionDate,
  extensionDays: schema.contract.extensionDays,
  retentionPct: schema.contract.retentionPct,
  performanceBondValue: schema.contract.performanceBondValue,
  bondExpiry: schema.contract.bondExpiry,
  liquidatedDamagesPerDay: schema.contract.liquidatedDamagesPerDay,
  defectsLiabilityMonths: schema.contract.defectsLiabilityMonths,
  sapPoNumber: schema.contract.sapPoNumber,
  emapRef: schema.contract.emapRef,
  budgetCode: schema.contract.budgetCode,
  createdAt: schema.contract.createdAt,
  updatedAt: schema.contract.updatedAt,
};

const VARIATION_COLUMNS = {
  id: schema.variation.id,
  contractId: schema.variation.contractId,
  number: schema.variation.number,
  descriptionEl: schema.variation.descriptionEl,
  reason: schema.variation.reason,
  value: schema.variation.value,
  timeImpactDays: schema.variation.timeImpactDays,
  status: schema.variation.status,
  raisedById: schema.variation.raisedBy,
  raisedByName: sql<string | null>`ecapital.user_display_name(${schema.variation.raisedBy})`,
  raisedAt: schema.variation.raisedAt,
  decidedById: schema.variation.decidedBy,
  decidedByName: sql<string | null>`ecapital.user_display_name(${schema.variation.decidedBy})`,
  decidedAt: schema.variation.decidedAt,
  decisionCommentEl: schema.variation.decisionCommentEl,
};

type VariationSelect = {
  id: string;
  contractId: string;
  number: number;
  descriptionEl: string;
  reason: Variation["reason"];
  value: string | number;
  timeImpactDays: number;
  status: Variation["status"];
  raisedById: string;
  raisedByName: string | null;
  raisedAt: Date;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionCommentEl: string | null;
};

function toVariationShape(row: VariationSelect): Variation {
  return {
    id: row.id,
    contractId: row.contractId,
    number: row.number,
    descriptionEl: row.descriptionEl,
    reason: row.reason,
    value: money(row.value),
    timeImpactDays: row.timeImpactDays,
    status: row.status,
    raisedById: row.raisedById,
    raisedByName: row.raisedByName ?? "",
    raisedAt: row.raisedAt.toISOString(),
    decidedById: row.decidedById,
    decidedByName: row.decidedByName ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionCommentEl: row.decisionCommentEl,
  };
}

function sumOf(variations: Variation[], status: Variation["status"]): number {
  const total = variations
    .filter((variation) => variation.status === status)
    .reduce((sum, variation) => sum + variation.value, 0);
  return Math.round(total * 100) / 100;
}

/** Today in UTC, as an ISO date. Every date column in the schema is a date. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Drop the keys the caller did not send, so a PATCH touches only what it names. */
function pruned<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
