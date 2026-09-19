import { Injectable } from "@nestjs/common";
import {
  type BoqItem,
  type BoqItemWrite,
  type ContractCreate,
  type ContractDetail,
  type ContractList,
  type ContractUpdate,
  type ProjectPhase,
  type Variation,
  type VariationCreate,
  type VariationDecision,
} from "@ecapital/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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

    try {
      const [row] = await tx.db
        .insert(schema.contract)
        .values({
          projectId,
          // The trigger overwrites this from the project; it is here because
          // the column is NOT NULL.
          orgUnitId: "",
          contractorId: input.contractorId,
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

    const [contractor, boq, variations] = await Promise.all([
      this.contractors.load(row.contractorId),
      this.boqOf(id),
      this.variationsOf(id),
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
      },
      today(),
    );

    return {
      ...contract,
      project: { id: project.id, code: project.code, titleEl: project.titleEl },
      contractor,
      boq,
      variations,
      approvedVariationsTotal,
      pendingVariationsTotal,
      variationPctOfOriginal,
      warnings: facts.map((fact) =>
        toWarning(this.i18n, fact, { nameEl: project.unitNameEl, nameEn: project.unitNameEn }),
      ),
    };
  }

  async update(id: string, input: ContractUpdate): Promise<ContractDetail> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(id);

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

const CONTRACT_COLUMNS = {
  id: schema.contract.id,
  projectId: schema.contract.projectId,
  orgUnitId: schema.contract.orgUnitId,
  contractorId: schema.contract.contractorId,
  contractorName: schema.contractor.name,
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
