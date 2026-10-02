/**
 * What eCapital's screens read about eFinance (ADR-0029): a contract's push
 * state and eFinance's figures for it, the invoices and requisitions tagged
 * with its reference, the budget position behind its budget code, and the
 * vendor search. All of it through the caller's own transaction, so a
 * contract in a unit the caller may not see answers 404 here as everywhere
 * (ADR-0010).
 *
 * When eFinance is not configured nothing here calls it: the figures are
 * null and every list says `configured: false`.
 */
import { Inject, Injectable } from "@nestjs/common";
import type {
  BudgetPosition,
  ContractBudgetPosition,
  EFinanceContractStatus,
  EFinanceContractSummary,
  EFinanceInvoice,
  EFinanceInvoiceList,
  EFinanceRequisitionList,
  EFinanceVendorList,
  ProjectBudgetPosition,
} from "@ecapital/shared";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import { currentTx, type Db } from "../db/client";
import * as schema from "../db/schema";
import { EFINANCE_CLIENT } from "./efinance-context";
import { EFinanceClient, toAmount } from "./efinance-client";
import {
  type ContractEFinanceRow,
  type StoredSpend,
  budgetPositionOf,
  isConflict,
  projectSummaryOf,
  summaryOf,
  toNumber,
} from "./efinance-rows";

/** A screen refresh must not become a call to eFinance every time (ADR-0029 §4). */
export const BUDGET_POSITION_TTL_MS = 60_000;

export interface ContractEFinanceFacts {
  configured: boolean;
  summary: EFinanceContractSummary | null;
  conflict: string | null;
}

@Injectable()
export class EFinanceReadService {
  private readonly positions = new Map<string, { at: number; value: Promise<BudgetPosition> }>();

  constructor(@Inject(EFINANCE_CLIENT) private readonly client: EFinanceClient) {}

  get configured(): boolean {
    return this.client.configured;
  }

  // ------------------------------------------------------------ contract --

  /** For ContractsService.detail: the summary and the conflict, or nothing. */
  async contractFacts(contractId: string): Promise<ContractEFinanceFacts> {
    if (!this.client.configured) return { configured: false, summary: null, conflict: null };
    const row = await this.contractRow(contractId);
    return {
      configured: true,
      summary: summaryOf(row),
      conflict: isConflict(row.lastError) ? row.lastError : null,
    };
  }

  /** GET /contracts/:id/efinance. The stored facts are shown even when the token is gone. */
  async contractStatus(contractId: string): Promise<EFinanceContractStatus> {
    const row = await this.contractRow(contractId);
    return { configured: this.client.configured, capRef: row.ref, ...summaryOf(row) };
  }

  /** The project cost screen: the sum over the project's contracts, or null. */
  async projectSummary(projectId: string): Promise<EFinanceContractSummary | null> {
    if (!this.client.configured) return null;
    const rows = await this.db()
      .select({
        pushedAt: schema.contract.efinancePushedAt,
        lastError: schema.contract.efinanceLastError,
        spend: schema.contract.efinanceSpend,
      })
      .from(schema.contract)
      .where(eq(schema.contract.projectId, projectId));
    return projectSummaryOf(rows.map((row) => ({ ...row, spend: (row.spend as StoredSpend | null) ?? null })));
  }

  /** Invoices tagged with the contract, newest first, the reversed ones with their reason. */
  async invoicesOf(contractId: string): Promise<EFinanceInvoiceList> {
    await this.contractRow(contractId);
    const db = this.db();
    const headers = await db
      .select()
      .from(schema.efinanceInvoice)
      .where(eq(schema.efinanceInvoice.contractId, contractId))
      .orderBy(desc(schema.efinanceInvoice.invoiceDate), desc(schema.efinanceInvoice.id));
    const ids = headers.map((header) => header.id);
    const lines = ids.length
      ? await db
          .select()
          .from(schema.efinanceInvoiceLine)
          .where(inArray(schema.efinanceInvoiceLine.invoiceId, ids))
          .orderBy(asc(schema.efinanceInvoiceLine.invoiceId), asc(schema.efinanceInvoiceLine.lineNo))
      : [];
    const byInvoice = new Map<string, EFinanceInvoice["lines"]>();
    for (const line of lines) {
      const list = byInvoice.get(line.invoiceId) ?? [];
      list.push({
        index: line.lineNo,
        descr: line.descr,
        qty: toNumber(line.qty),
        unitPrice: toAmount(line.unitPrice),
        lineTotal: toAmount(line.lineTotal),
        vatRate: toNumber(line.vatRate),
        glAccount: line.glAccount,
        costCentre: line.costCentre,
        budgetCode: line.budgetCode,
        wbsCode: line.wbsCode,
      });
      byInvoice.set(line.invoiceId, list);
    }
    const items: EFinanceInvoice[] = headers.map((header) => ({
      id: header.id,
      invoiceNo: header.invoiceNo,
      invoiceDate: header.invoiceDate,
      sapBatchDate: header.sapBatchDate,
      vendorCode: header.vendorCode,
      vendorName: header.vendorName,
      entityCode: header.entityCode,
      currency: header.currency,
      net: toAmount(header.net),
      vat: toAmount(header.vat),
      gross: toAmount(header.gross),
      status: header.status,
      ledger: header.ledger as EFinanceInvoice["ledger"],
      capRef: header.capRef,
      reversedAt: header.reversedAt ? header.reversedAt.toISOString() : null,
      reversalSapDocNo: header.reversalSapDocNo,
      reversalReason: header.reversalReason,
      updatedAt: header.updatedAt.toISOString(),
      lines: byInvoice.get(header.id) ?? [],
    }));
    return { configured: this.client.configured, items, total: items.length };
  }

  /** eFinance-side commitments on the contract — shown, never summed into eCapital's. */
  async requisitionsOf(contractId: string): Promise<EFinanceRequisitionList> {
    await this.contractRow(contractId);
    const rows = await this.db()
      .select()
      .from(schema.efinanceRequisition)
      .where(eq(schema.efinanceRequisition.contractId, contractId))
      .orderBy(desc(schema.efinanceRequisition.createdAt));
    const items = rows.map((row) => ({
      id: row.id,
      number: row.number,
      description: row.description,
      justification: row.justification,
      entityCode: row.entityCode,
      costCentre: row.costCentre,
      budgetCode: row.budgetCode,
      glAccount: row.glAccount,
      amount: toAmount(row.amount),
      currency: row.currency,
      status: row.status,
      capRef: row.capRef,
      poNumber: row.poNumber,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
    return { configured: this.client.configured, items, total: items.length };
  }

  // ------------------------------------------------------ budget position --

  /**
   * GET /contracts/:id/budget-position. ASSUMPTION (ADR-0029 §4): the year
   * is the contract's award year unless the caller asks for another, the
   * unit is sent in eArchive's form (record §2: eFinance translates), and
   * the code is the contract's budget code. No code, no position.
   */
  async contractPosition(contractId: string, year?: number): Promise<ContractBudgetPosition> {
    const contract = await this.positionKeyOf(contractId);
    if (!this.client.configured) return { configured: false, position: null };
    if (!contract.budgetCode) return { configured: true, position: null };
    const position = await this.position({
      entityCode: contract.unitCode,
      budgetCode: contract.budgetCode,
      year: year ?? contract.awardYear,
    });
    return { configured: true, position };
  }

  /** GET /projects/:id/budget-position: one row per (code, year) its contracts are charged to. */
  async projectPosition(projectId: string, year?: number): Promise<ProjectBudgetPosition> {
    if (!UUID.test(projectId)) throw AppError.notFound("errors.projectNotFound");
    const [project] = await this.db()
      .select({ id: schema.project.id, unitCode: schema.orgUnit.code })
      .from(schema.project)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.project.orgUnitId))
      .where(eq(schema.project.id, projectId))
      .limit(1);
    if (!project) throw AppError.notFound("errors.projectNotFound");
    if (!this.client.configured) return { configured: false, items: [] };

    const contracts = await this.db()
      .select({ budgetCode: schema.contract.budgetCode, awardDate: schema.contract.awardDate })
      .from(schema.contract)
      .where(eq(schema.contract.projectId, projectId));
    const keys = new Map<string, { budgetCode: string; year: number }>();
    for (const contract of contracts) {
      if (!contract.budgetCode) continue;
      const keyYear = year ?? Number(contract.awardDate.slice(0, 4));
      keys.set(`${contract.budgetCode}|${keyYear}`, { budgetCode: contract.budgetCode, year: keyYear });
    }
    const sorted = [...keys.values()].sort((a, b) =>
      a.budgetCode === b.budgetCode ? a.year - b.year : a.budgetCode.localeCompare(b.budgetCode),
    );
    const items: BudgetPosition[] = [];
    for (const key of sorted) {
      items.push(await this.position({ entityCode: project.unitCode, ...key }));
    }
    return { configured: true, items };
  }

  /** The cached call. A failed answer is not cached; the next refresh asks again. */
  private position(key: { entityCode: string; budgetCode: string; year: number }): Promise<BudgetPosition> {
    const cacheKey = `${key.entityCode}|${key.budgetCode}|${key.year}`;
    const now = Date.now();
    const hit = this.positions.get(cacheKey);
    if (hit && now - hit.at < BUDGET_POSITION_TTL_MS) return hit.value;

    const value = this.client
      .budgetPosition({ year: key.year, entity: key.entityCode, code: key.budgetCode })
      .then((answer) => budgetPositionOf(answer.items, answer.asOf, key));
    this.positions.set(cacheKey, { at: now, value });
    value.catch(() => this.positions.delete(cacheKey));
    return value;
  }

  /** For the tests: forget every cached position. */
  clearCache(): void {
    this.positions.clear();
  }

  // -------------------------------------------------------------- vendors --

  /** GET /efinance/vendors?q= — name or code, folded, twenty at most. */
  async vendors(q: string | undefined): Promise<EFinanceVendorList> {
    const needle = q?.trim() ?? "";
    const pattern = sql`'%' || ecapital.normalise(${needle}) || '%'`;
    const rows = await this.db()
      .select({
        vendorCode: schema.efinanceVendor.vendorCode,
        name: schema.efinanceVendor.name,
        vat: schema.efinanceVendor.vat,
        blocked: schema.efinanceVendor.blocked,
        active: schema.efinanceVendor.active,
      })
      .from(schema.efinanceVendor)
      .where(
        needle
          ? sql`(${schema.efinanceVendor.nameNorm} like ${pattern}
                 or ${schema.efinanceVendor.vendorCode} ilike ${needle + "%"})`
          : undefined,
      )
      .orderBy(
        sql`(${schema.efinanceVendor.vendorCode} = ${needle}) desc`,
        desc(schema.efinanceVendor.active),
        asc(schema.efinanceVendor.name),
      )
      .limit(20);
    return { items: rows };
  }

  // ------------------------------------------------------------ internals --

  private db(): Db {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    return tx.db;
  }

  private async contractRow(contractId: string): Promise<ContractEFinanceRow & { ref: string }> {
    if (!UUID.test(contractId)) throw AppError.notFound("errors.contractNotFound");
    const [row] = await this.db()
      .select({
        ref: schema.contract.ref,
        pushedAt: schema.contract.efinancePushedAt,
        lastError: schema.contract.efinanceLastError,
        spend: schema.contract.efinanceSpend,
      })
      .from(schema.contract)
      .where(eq(schema.contract.id, contractId))
      .limit(1);
    if (!row) throw AppError.notFound("errors.contractNotFound");
    return { ...row, spend: (row.spend as StoredSpend | null) ?? null };
  }

  private async positionKeyOf(
    contractId: string,
  ): Promise<{ budgetCode: string | null; unitCode: string; awardYear: number }> {
    if (!UUID.test(contractId)) throw AppError.notFound("errors.contractNotFound");
    const [row] = await this.db()
      .select({
        budgetCode: schema.contract.budgetCode,
        awardDate: schema.contract.awardDate,
        unitCode: schema.orgUnit.code,
      })
      .from(schema.contract)
      .innerJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.contract.orgUnitId))
      .where(eq(schema.contract.id, contractId))
      .limit(1);
    if (!row) throw AppError.notFound("errors.contractNotFound");
    return { budgetCode: row.budgetCode, unitCode: row.unitCode, awardYear: Number(row.awardDate.slice(0, 4)) };
  }
}
