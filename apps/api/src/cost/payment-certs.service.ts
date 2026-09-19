/**
 * R11 — payment certificates, from draft to paid.
 *
 * CAPEX-01 §4 gives the columns and §10 gives the rule that matters:
 * "payment certificate approval requires a different user from the one who
 * created it". ADR-0015 wrote that rule three times for variations — in the
 * service, on the route and as a CHECK constraint — and said doing the same
 * here was the precedent it was setting. It is done here.
 *
 * The three derived figures are the API's and never the caller's. A body
 * carrying a `netPayable` is ignored: `PaymentCertCreate` has no room for one
 * (packages/shared), and the arithmetic lives in `derivePaymentCert` where it
 * can be tested without a database.
 *
 * RULE (CAPEX-01 §1, R31): nothing here blocks. A certificate that takes the
 * cumulative certified above the contract's current value is saved and fires
 * a warning; retention released before the defects-liability period ends is
 * saved and fires a warning. Finance decides on blocking later.
 */
import { Injectable } from "@nestjs/common";
import type { PaymentCert, PaymentCertCreate, PaymentCertStatus } from "@ecapital/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { CHECK_VIOLATION, INSUFFICIENT_PRIVILEGE, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import type { PaymentCertTransitionBody } from "./cost-contracts";
import { type PaymentCertRow, derivePaymentCert, money, round2, toPaymentCert } from "./cost-rows";
import { CostWarningsService } from "./cost-warnings.service";

const ORDER: PaymentCertStatus[] = ["DRAFT", "ENGINEER_APPROVED", "FINANCE_RECEIVED", "PAID"];

/** Who may take each step. The route lets all five roles in; this narrows it. */
const ROLES_FOR: Record<PaymentCertStatus, string[]> = {
  DRAFT: [],
  // The engineer who is running the works signs off what was built, and the
  // head of estates can do it too — CAPEX-01 §1's two site-side personas.
  ENGINEER_APPROVED: ["project_engineer", "estates_head", "admin"],
  // From here it is money leaving the organisation, and that is finance's.
  FINANCE_RECEIVED: ["finance", "admin"],
  PAID: ["finance", "admin"],
};

@Injectable()
export class PaymentCertsService {
  constructor(private readonly warnings: CostWarningsService) {}

  async listForContract(contractId: string): Promise<PaymentCert[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.loadContract(contractId);
    const rows = await tx.db
      .select(CERT_COLUMNS)
      .from(schema.paymentCert)
      .where(eq(schema.paymentCert.contractId, contractId))
      .orderBy(asc(schema.paymentCert.number));
    return rows.map((row) => toPaymentCert(row as PaymentCertRow));
  }

  /**
   * R11. The number is allocated by the database behind an advisory lock on
   * the contract, the same way a variation's is (ADR-0015): two engineers
   * certifying in the same second get 4 and 5, never two fours.
   */
  async create(contractId: string, input: PaymentCertCreate): Promise<PaymentCert> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const contract = await this.loadContract(contractId);
    const caller = await callerUserId();

    if (input.periodTo < input.periodFrom) {
      throw AppError.unprocessable("errors.certPeriodNotValid");
    }

    const previous = await this.previousCertifiedOn(contractId, null);
    const derived = derivePaymentCert({
      workDoneValue: input.workDoneValue,
      materialsOnSite: input.materialsOnSite,
      retentionPct: money(contract.retentionPct),
      previousCertified: previous,
    });

    try {
      const [{ number }] = await tx.db
        .select({
          number: sql<number>`ecapital.allocate_payment_cert_number(${contractId}::uuid)`,
        })
        .from(sql`(select 1) as one`);

      const [row] = await tx.db
        .insert(schema.paymentCert)
        .values({
          contractId,
          // The trigger overwrites this from the contract; it is here because
          // the column is NOT NULL.
          orgUnitId: contract.orgUnitId,
          number,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          workDoneValue: String(input.workDoneValue),
          materialsOnSite: String(input.materialsOnSite),
          retentionHeld: String(derived.retentionHeld),
          previousCertified: String(derived.previousCertified),
          netPayable: String(derived.netPayable),
          status: "DRAFT",
          createdBy: caller,
        })
        .returning({ id: schema.paymentCert.id });

      // R31: this may be the certificate that takes the contract past its
      // value. It is saved either way and somebody is told.
      await this.warnings.evaluate(contract.projectId);
      return await this.detail(row.id);
    } catch (error) {
      this.writeError(error);
    }
  }

  async detail(id: string): Promise<PaymentCert> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.paymentCertNotFound");
    const rows = await tx.db
      .select(CERT_COLUMNS)
      .from(schema.paymentCert)
      .where(eq(schema.paymentCert.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.paymentCertNotFound");
    return toPaymentCert(rows[0] as PaymentCertRow);
  }

  /**
   * R11. DRAFT → ENGINEER_APPROVED → FINANCE_RECEIVED → PAID, forward only.
   *
   * RULE (CAPEX-01 §10): the approver is never the creator —
   * errors.sameUserApproval, 403. Checked here for the sentence, and again by
   * the CHECK constraint in migration 0011 so that it holds for a console
   * session and a repair script too (ADR-0015).
   *
   * RULE (R11): FINANCE_RECEIVED needs the SAP invoice reference and PAID
   * needs the date it was paid. Both are constraints as well.
   */
  async transition(id: string, input: PaymentCertTransitionBody): Promise<PaymentCert> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const current = await this.detail(id);
    const contract = await this.loadContract(current.contractId);
    const caller = await callerUserId();

    const from = ORDER.indexOf(current.status);
    const to = ORDER.indexOf(input.to);
    if (to !== from + 1) throw AppError.unprocessable("errors.certTransitionNotAllowed");

    const allowed = ROLES_FOR[input.to];
    const held = tx.context.roles ?? [];
    if (!allowed.some((role) => held.includes(role))) {
      throw AppError.forbidden("errors.certRoleNotAllowed");
    }

    const values: Record<string, unknown> = { status: input.to, updatedAt: sql`now()` };

    if (input.to === "ENGINEER_APPROVED") {
      if (caller === current.createdById) throw AppError.forbidden("errors.sameUserApproval");
      values.approvedBy = caller;
      values.approvedAt = sql`now()`;
    }
    if (input.to === "FINANCE_RECEIVED") {
      const reference = input.sapInvoiceRef?.trim() ?? "";
      if (reference === "") throw AppError.unprocessable("errors.sapInvoiceRefNeeded");
      values.sapInvoiceRef = reference;
    }
    if (input.to === "PAID") {
      if (!input.paidDate) throw AppError.unprocessable("errors.paidDateNeeded");
      values.paidDate = input.paidDate;
    }
    if (input.retentionReleased !== undefined) {
      values.retentionReleased = input.retentionReleased;
    }

    try {
      const touched = await tx.db
        .update(schema.paymentCert)
        .set(values)
        .where(eq(schema.paymentCert.id, id))
        .returning({ id: schema.paymentCert.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.writeError(error);
    }

    // R31: the transition may have released retention early, or moved the
    // certified total. Both are warnings and neither is a refusal.
    await this.warnings.evaluate(contract.projectId);
    return this.detail(id);
  }

  /**
   * R18. What has been certified on this contract before the certificate
   * being written: the gross of every earlier one. `workDoneValue` is
   * cumulative to date (packages/shared), so this is what comes off the top.
   */
  private async previousCertifiedOn(contractId: string, excludeId: string | null): Promise<number> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const [row] = await tx.db
      .select({
        total: sql<string>`coalesce(sum(${schema.paymentCert.workDoneValue}
                                       + ${schema.paymentCert.materialsOnSite}), 0)`,
      })
      .from(schema.paymentCert)
      .where(
        excludeId
          ? and(
              eq(schema.paymentCert.contractId, contractId),
              sql`${schema.paymentCert.id} <> ${excludeId}`,
            )
          : eq(schema.paymentCert.contractId, contractId),
      );
    return round2(money(row?.total));
  }

  async loadContract(id: string): Promise<{
    id: string;
    projectId: string;
    orgUnitId: string;
    contractNo: string;
    retentionPct: string;
  }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.contractNotFound");
    const rows = await tx.db
      .select({
        id: schema.contract.id,
        projectId: schema.contract.projectId,
        orgUnitId: schema.contract.orgUnitId,
        contractNo: schema.contract.contractNo,
        retentionPct: schema.contract.retentionPct,
      })
      .from(schema.contract)
      .where(eq(schema.contract.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractNotFound");
    return rows[0];
  }

  /** What the database refused, said in the caller's language. */
  private writeError(error: unknown): never {
    if (error instanceof AppError) throw error;
    const state = sqlState(error);
    if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
    // The CHECKs a caller can reach here are R11's segregation rule and the
    // two that guard the finance fields. The service refuses all three first;
    // reaching one means a code path went round it.
    if (state === CHECK_VIOLATION) throw AppError.forbidden("errors.sameUserApproval");
    throw error;
  }
}

const CERT_COLUMNS = {
  id: schema.paymentCert.id,
  contractId: schema.paymentCert.contractId,
  orgUnitId: schema.paymentCert.orgUnitId,
  number: schema.paymentCert.number,
  periodFrom: schema.paymentCert.periodFrom,
  periodTo: schema.paymentCert.periodTo,
  workDoneValue: schema.paymentCert.workDoneValue,
  materialsOnSite: schema.paymentCert.materialsOnSite,
  retentionHeld: schema.paymentCert.retentionHeld,
  previousCertified: schema.paymentCert.previousCertified,
  netPayable: schema.paymentCert.netPayable,
  status: schema.paymentCert.status,
  createdById: schema.paymentCert.createdBy,
  createdByName: sql<string | null>`ecapital.user_display_name(${schema.paymentCert.createdBy})`,
  approvedById: schema.paymentCert.approvedBy,
  approvedByName: sql<string | null>`ecapital.user_display_name(${schema.paymentCert.approvedBy})`,
  approvedAt: schema.paymentCert.approvedAt,
  sapInvoiceRef: schema.paymentCert.sapInvoiceRef,
  paidDate: schema.paymentCert.paidDate,
  retentionReleased: schema.paymentCert.retentionReleased,
};
