/**
 * Reads from eFinance into eCapital (ADR-0029 §3–§5): the invoices and
 * requisitions tagged with a CAP- reference, the spend figures eFinance holds
 * per contract, and — once a day — the entity codes and the vendor list.
 *
 * The invoice and requisition feeds poll with `updated_since` set to the
 * highest `updated_at` seen (record §3, "Incremental sync"); the very first
 * run, before any row has been seen, asks by reference for every contract
 * eFinance has accepted. Every row is an upsert by eFinance's own id, so a
 * second run of the same answer changes nothing.
 *
 * A booked invoice becomes one ACTUAL cost_txn per line in eCapital's own
 * ledger (source EFINANCE, sourceRef `efinance:invoice:<id>:<line index>`),
 * upserted on that reference — never duplicated. An invoice that leaves
 * `booked` (a reversal, most often) is re-projected to nothing, which removes
 * what it booked; the invoice itself stays in `efinance_invoice` with its
 * reason. In-flight invoices and requisitions are stored and shown per
 * contract and never enter the ledger: in flight is not spend, and a
 * requisition is eFinance's commitment, not eCapital's (ADR-0015).
 *
 * Everything here runs inside a row-level-security transaction: the caller's
 * own when an administrator presses the button, the service identity's when
 * the timer fires (efinance-context.ts).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type {
  EFinanceFeedResult,
  EFinanceMasterSyncResult,
  EFinanceRawInvoice,
  EFinanceRawRequisition,
  EFinanceSyncResult,
} from "@ecapital/shared";
import { and, eq, lt, sql } from "drizzle-orm";
import { AppError } from "../common/errors";
import { CONFIG, type AppConfig } from "../config";
import { DatabaseService, currentTx, type Db } from "../db/client";
import * as schema from "../db/schema";
import { EFINANCE_CLIENT, EFINANCE_SYSTEM_CONTEXT } from "./efinance-context";
import { EFinanceClient, EFinanceError } from "./efinance-client";
import {
  dateOnly,
  invoiceSourcePrefix,
  laterOf,
  projectedLines,
  spendJson,
  toNumber,
} from "./efinance-rows";

export const SYNC_INTERVAL_MS = 15 * 60_000;
/** The master data (entities, vendors) is refreshed once a day, inside the same timer. */
export const MASTER_EVERY_MS = 24 * 60 * 60_000;

type Feed = "invoices" | "requisitions" | "master";

interface ContractRef {
  id: string;
  projectId: string;
  orgUnitId: string;
}

@Injectable()
export class EFinanceSyncService {
  private readonly logger = new Logger(EFinanceSyncService.name);
  private running = false;

  constructor(
    @Inject(EFINANCE_CLIENT) private readonly client: EFinanceClient,
    private readonly database: DatabaseService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  get configured(): boolean {
    return this.client.configured;
  }

  // --------------------------------------------------------------- timer --

  @Interval("ecapital.efinance.sync", SYNC_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.config.NODE_ENV === "test") return;
    if (!this.client.configured || this.running) return;
    this.running = true;
    try {
      await this.database.withRls(EFINANCE_SYSTEM_CONTEXT, () => this.sync());
      const due = await this.database.withRls(EFINANCE_SYSTEM_CONTEXT, () => this.masterDue());
      if (due) await this.database.withRls(EFINANCE_SYSTEM_CONTEXT, () => this.syncMaster());
    } catch (error) {
      this.logger.error(`efinance sync did not complete: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------- invoices, reqs --

  /** POST /admin/efinance/sync, and the timer. One pass over both feeds. */
  async sync(): Promise<EFinanceSyncResult> {
    const ranAt = new Date().toISOString();
    if (!this.client.configured) {
      const idle: EFinanceFeedResult = { rows: 0, cursor: null, error: null };
      return { configured: false, invoices: idle, requisitions: idle, contractsRefreshed: 0, ranAt };
    }
    const touched = new Set<string>();
    const refs = new Map<string, ContractRef | null>();

    const invoices = await this.runFeed(
      "invoices",
      (ref) => this.client.invoicesByRef(ref),
      (cursor, page) => this.client.invoicesSince(cursor, page),
      (row: EFinanceRawInvoice) => this.upsertInvoice(row, refs, touched),
    );
    const requisitions = await this.runFeed(
      "requisitions",
      (ref) => this.client.requisitionsByRef(ref),
      (cursor, page) => this.client.requisitionsSince(cursor, page),
      (row: EFinanceRawRequisition) => this.upsertRequisition(row, refs, touched),
    );
    const contractsRefreshed = await this.refreshSpend(touched);

    return { configured: true, invoices, requisitions, contractsRefreshed, ranAt };
  }

  private async runFeed<T extends { updated_at: string }>(
    feed: Feed,
    byRef: (ref: string) => Promise<T[]>,
    since: (cursor: string, page: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
    upsert: (row: T) => Promise<boolean>,
  ): Promise<EFinanceFeedResult> {
    const db = this.db();
    const state = await this.state(feed);
    let cursor = state.cursor;
    let rows = 0;

    const take = async (items: T[]) => {
      for (const item of items) {
        if (await upsert(item)) rows += 1;
        cursor = laterOf(cursor, item.updated_at);
      }
    };

    try {
      if (state.cursor === null) {
        // First run: nothing seen yet, so there is no `updated_since` to send.
        // Ask by reference for every contract eFinance has accepted (record
        // §6: nothing can be tagged with a contract eFinance does not have).
        const pushed = await db
          .select({ ref: schema.contract.ref })
          .from(schema.contract)
          .where(sql`${schema.contract.efinancePushedAt} is not null`)
          .orderBy(schema.contract.ref);
        for (const { ref } of pushed) await take(await byRef(ref));
      } else {
        let page: string | null = null;
        for (let guard = 0; guard < 10_000; guard += 1) {
          const answer = await since(state.cursor, page);
          await take(answer.items);
          if (!answer.nextCursor || answer.nextCursor === page) break;
          page = answer.nextCursor;
        }
      }
    } catch (error) {
      if (!(error instanceof EFinanceError)) throw error;
      await this.saveState(feed, { cursor: state.cursor, rows, error: error.summary });
      this.logger.warn(`efinance ${feed} feed: ${error.summary}`);
      return { rows, cursor: state.cursor, error: error.summary };
    }

    await this.saveState(feed, { cursor, rows, error: null });
    return { rows, cursor, error: null };
  }

  /**
   * One invoice: the header and its lines replaced, then projected into the
   * ledger. Returns false — and writes nothing — when eFinance's copy has
   * not changed since the last time this side stored it.
   */
  private async upsertInvoice(
    invoice: EFinanceRawInvoice,
    refs: Map<string, ContractRef | null>,
    touched: Set<string>,
  ): Promise<boolean> {
    const db = this.db();
    const id = String(invoice.id);
    const contract = await this.resolve(invoice.cap_ref, refs);
    const updatedAt = new Date(invoice.updated_at);

    const [existing] = await db
      .select({ updatedAt: schema.efinanceInvoice.updatedAt, contractId: schema.efinanceInvoice.contractId })
      .from(schema.efinanceInvoice)
      .where(eq(schema.efinanceInvoice.id, id))
      .limit(1);
    if (
      existing &&
      existing.updatedAt.getTime() === updatedAt.getTime() &&
      existing.contractId === (contract?.id ?? null)
    ) {
      return false;
    }

    const header = {
      orgUnitId: contract?.orgUnitId ?? null,
      contractId: contract?.id ?? null,
      invoiceNo: invoice.invoice_no,
      invoiceDate: dateOnly(invoice.invoice_date),
      sapBatchDate: dateOnly(invoice.sap_batch_date),
      vendorCode: invoice.vendor_code,
      vendorName: invoice.vendor_name,
      entityCode: invoice.entity_code,
      currency: invoice.currency,
      net: invoice.net,
      vat: invoice.vat,
      gross: invoice.gross,
      status: invoice.status,
      ledger: invoice.ledger,
      capRef: invoice.cap_ref,
      reversedAt: invoice.reversed_at ? new Date(invoice.reversed_at) : null,
      reversalSapDocNo: invoice.reversal_sap_doc_no,
      reversalReason: invoice.reversal_reason,
      updatedAt,
      raw: invoice as unknown as Record<string, unknown>,
      syncedAt: new Date(),
    };
    await db
      .insert(schema.efinanceInvoice)
      .values({ id, ...header })
      .onConflictDoUpdate({ target: schema.efinanceInvoice.id, set: header });

    await db.delete(schema.efinanceInvoiceLine).where(eq(schema.efinanceInvoiceLine.invoiceId, id));
    if (invoice.lines.length) {
      await db.insert(schema.efinanceInvoiceLine).values(
        invoice.lines.map((line, index) => ({
          invoiceId: id,
          lineNo: index,
          orgUnitId: contract?.orgUnitId ?? null,
          descr: line.descr,
          qty: numericOrNull(line.qty),
          unitPrice: line.unit_price,
          lineTotal: line.line_total,
          vatRate: numericOrNull(line.vat_rate),
          glAccount: line.gl_account,
          costCentre: line.cost_centre,
          budgetCode: line.budget_code,
          wbsCode: line.wbs_code,
        })),
      );
    }

    await this.project(invoice, contract);
    if (contract) touched.add(contract.id);
    if (existing?.contractId && existing.contractId !== contract?.id) touched.add(existing.contractId);
    return true;
  }

  /**
   * RULE (ADR-0029): the invoice's lines in the ledger are exactly what
   * `projectedLines` says they are now. Lines it no longer names — every
   * line, for an invoice that is no longer booked, or one whose CAP-
   * reference now points at a different project — are deleted; the rest are
   * upserted on (project, source, sourceRef), so a second run never adds a
   * row. A cost_txn from eFinance is matched by rule (`RULE`), never by hand.
   */
  private async project(invoice: EFinanceRawInvoice, contract: ContractRef | null): Promise<void> {
    const db = this.db();
    const prefix = invoiceSourcePrefix(String(invoice.id));
    const lines = contract ? projectedLines(invoice) : [];
    const keep = lines.map((line) => line.sourceRef);

    await db.execute(sql`
      delete from ecapital.cost_txn t
       where t.source = 'EFINANCE'
         and starts_with(t.source_ref, ${prefix})
         and (t.project_id is distinct from ${contract?.projectId ?? null}::uuid
              or not (t.source_ref = any (${toPgArray(keep)}::text[])))`);

    if (!contract) return;
    for (const line of lines) {
      await db.execute(sql`
        insert into ecapital.cost_txn
          (org_unit_id, project_id, contract_id, txn_type, source, source_ref,
           doc_date, posting_date, amount, currency, description,
           vendor_name, sap_wbs, cost_centre, gl_account, matched_by)
        values
          (${contract.orgUnitId}, ${contract.projectId}::uuid, ${contract.id}::uuid, 'ACTUAL', 'EFINANCE', ${line.sourceRef},
           ${line.docDate}::date, ${line.postingDate}::date, ${line.amount}::numeric, 'EUR', ${line.description},
           ${line.vendorName}, ${line.sapWbs}, ${line.costCentre}, ${line.glAccount}, 'RULE')
        on conflict (project_id, source, source_ref)
          where project_id is not null and source_ref is not null
        do update set
          contract_id  = excluded.contract_id,
          doc_date     = excluded.doc_date,
          posting_date = excluded.posting_date,
          amount       = excluded.amount,
          description  = excluded.description,
          vendor_name  = excluded.vendor_name,
          sap_wbs      = excluded.sap_wbs,
          cost_centre  = excluded.cost_centre,
          gl_account   = excluded.gl_account,
          matched_by   = excluded.matched_by,
          updated_at   = now()
        where (ecapital.cost_txn.contract_id, ecapital.cost_txn.doc_date, ecapital.cost_txn.posting_date,
               ecapital.cost_txn.amount, ecapital.cost_txn.description, ecapital.cost_txn.vendor_name,
               ecapital.cost_txn.sap_wbs, ecapital.cost_txn.cost_centre, ecapital.cost_txn.gl_account)
          is distinct from
              (excluded.contract_id, excluded.doc_date, excluded.posting_date,
               excluded.amount, excluded.description, excluded.vendor_name,
               excluded.sap_wbs, excluded.cost_centre, excluded.gl_account)`);
    }
  }

  private async upsertRequisition(
    requisition: EFinanceRawRequisition,
    refs: Map<string, ContractRef | null>,
    touched: Set<string>,
  ): Promise<boolean> {
    const db = this.db();
    const id = String(requisition.id);
    const contract = await this.resolve(requisition.cap_ref, refs);
    const updatedAt = new Date(requisition.updated_at);

    const [existing] = await db
      .select({ updatedAt: schema.efinanceRequisition.updatedAt, contractId: schema.efinanceRequisition.contractId })
      .from(schema.efinanceRequisition)
      .where(eq(schema.efinanceRequisition.id, id))
      .limit(1);
    if (
      existing &&
      existing.updatedAt.getTime() === updatedAt.getTime() &&
      existing.contractId === (contract?.id ?? null)
    ) {
      return false;
    }

    const values = {
      orgUnitId: contract?.orgUnitId ?? null,
      contractId: contract?.id ?? null,
      number: requisition.number,
      description: requisition.description,
      justification: requisition.justification,
      entityCode: requisition.entity_code,
      costCentre: requisition.cost_centre,
      budgetCode: requisition.budget_code,
      glAccount: requisition.gl_account,
      amount: requisition.amount,
      currency: requisition.currency,
      status: requisition.status,
      capRef: requisition.cap_ref,
      poNumber: requisition.po_number,
      createdAt: new Date(requisition.created_at),
      updatedAt,
      raw: requisition as unknown as Record<string, unknown>,
      syncedAt: new Date(),
    };
    await db
      .insert(schema.efinanceRequisition)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: schema.efinanceRequisition.id, set: values });

    if (contract) touched.add(contract.id);
    if (existing?.contractId && existing.contractId !== contract?.id) touched.add(existing.contractId);
    return true;
  }

  /**
   * eFinance's own figures for every contract this run touched, and for any
   * accepted contract that has none yet (record §4's GET: the stored copy
   * plus booked, in flight, requisitions and remaining). A contract eFinance
   * no longer knows (404) is left as it was.
   */
  private async refreshSpend(touched: Set<string>): Promise<number> {
    const db = this.db();
    const rows = await db
      .select({ id: schema.contract.id, ref: schema.contract.ref, spend: schema.contract.efinanceSpend })
      .from(schema.contract)
      .where(sql`${schema.contract.efinancePushedAt} is not null`);
    let refreshed = 0;
    for (const row of rows) {
      if (!touched.has(row.id) && row.spend !== null) continue;
      try {
        const answer = await this.client.getContract(row.ref);
        await db.execute(
          sql`select ecapital.efinance_record_spend(${row.id}::uuid, ${JSON.stringify(spendJson(answer))}::jsonb)`,
        );
        refreshed += 1;
      } catch (error) {
        if (!(error instanceof EFinanceError)) throw error;
        this.logger.warn(`efinance spend for ${row.ref}: ${error.summary}`);
        if (error.code !== "NOT_FOUND") break;
      }
    }
    return refreshed;
  }

  // -------------------------------------------------------------- master --

  /** POST /admin/efinance/sync-master, and the timer once a day. */
  async syncMaster(): Promise<EFinanceMasterSyncResult> {
    const ranAt = new Date();
    if (!this.client.configured) {
      return {
        configured: false,
        unitsMatched: 0,
        vendorsUpserted: 0,
        vendorsDeactivated: 0,
        error: null,
        ranAt: ranAt.toISOString(),
      };
    }
    const db = this.db();
    let unitsMatched = 0;
    let vendorsUpserted = 0;
    let vendorsDeactivated = 0;

    try {
      // Record §2: `entities` returns both forms. eCapital's unit code is
      // eArchive's (ADR-0024), so `archive_code` finds the unit and `code` is
      // what goes in org_unit.efinance_code (ADR-0022's addendum).
      const entities = await this.client.entities();
      for (const entity of entities) {
        if (!entity.archive_code) continue;
        const matched = await db
          .select({ id: schema.orgUnit.id, efinanceCode: schema.orgUnit.efinanceCode })
          .from(schema.orgUnit)
          .where(eq(schema.orgUnit.code, entity.archive_code))
          .limit(1);
        if (!matched.length) continue;
        unitsMatched += 1;
        if (matched[0].efinanceCode !== entity.code) {
          await db
            .update(schema.orgUnit)
            .set({ efinanceCode: entity.code, updatedAt: sql`now()` })
            .where(eq(schema.orgUnit.id, matched[0].id));
        }
      }

      const vendors = await this.client.vendors();
      for (let start = 0; start < vendors.length; start += 500) {
        const chunk = vendors.slice(start, start + 500).map((vendor) => ({
          vendorCode: (vendor.vendor_code ?? vendor.code) as string,
          name: vendor.name,
          vat: vendor.vat ?? vendor.vat_no ?? null,
          blocked: vendor.blocked,
          active: vendor.active,
          sapBatch: vendor.sap_batch ?? null,
          syncedAt: ranAt,
        }));
        // The same code twice in one answer would make the upsert touch a row
        // twice; the last one eFinance sent wins.
        const unique = [...new Map(chunk.map((vendor) => [vendor.vendorCode, vendor])).values()];
        await db
          .insert(schema.efinanceVendor)
          .values(unique)
          .onConflictDoUpdate({
            target: schema.efinanceVendor.vendorCode,
            set: {
              name: sql`excluded.name`,
              vat: sql`excluded.vat`,
              blocked: sql`excluded.blocked`,
              active: sql`excluded.active`,
              sapBatch: sql`excluded.sap_batch`,
              syncedAt: sql`excluded.synced_at`,
            },
          });
        vendorsUpserted += unique.length;
      }
      // Latest SAP batch only (record §3): a vendor eFinance no longer lists
      // is marked inactive, never deleted.
      const gone = await db
        .update(schema.efinanceVendor)
        .set({ active: false })
        .where(and(eq(schema.efinanceVendor.active, true), lt(schema.efinanceVendor.syncedAt, ranAt)))
        .returning({ vendorCode: schema.efinanceVendor.vendorCode });
      vendorsDeactivated = gone.length;
    } catch (error) {
      if (!(error instanceof EFinanceError)) throw error;
      await this.saveState("master", { cursor: null, rows: vendorsUpserted, error: error.summary });
      return {
        configured: true,
        unitsMatched,
        vendorsUpserted,
        vendorsDeactivated,
        error: error.summary,
        ranAt: ranAt.toISOString(),
      };
    }

    await this.saveState("master", { cursor: null, rows: vendorsUpserted, error: null });
    return {
      configured: true,
      unitsMatched,
      vendorsUpserted,
      vendorsDeactivated,
      error: null,
      ranAt: ranAt.toISOString(),
    };
  }

  private async masterDue(): Promise<boolean> {
    const state = await this.state("master");
    return !state.lastSuccessAt || Date.now() - state.lastSuccessAt.getTime() >= MASTER_EVERY_MS;
  }

  // ----------------------------------------------------------- internals --

  private db(): Db {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    return tx.db;
  }

  /** A CAP- reference to the contract it names, once per run. */
  private async resolve(capRef: string | null, cache: Map<string, ContractRef | null>): Promise<ContractRef | null> {
    if (!capRef) return null;
    if (cache.has(capRef)) return cache.get(capRef) ?? null;
    const [row] = await this.db()
      .select({
        id: schema.contract.id,
        projectId: schema.contract.projectId,
        orgUnitId: schema.contract.orgUnitId,
      })
      .from(schema.contract)
      .where(eq(schema.contract.ref, capRef))
      .limit(1);
    cache.set(capRef, row ?? null);
    return row ?? null;
  }

  private async state(feed: Feed): Promise<{ cursor: string | null; lastSuccessAt: Date | null }> {
    const [row] = await this.db()
      .select({ cursor: schema.efinanceSyncState.cursor, lastSuccessAt: schema.efinanceSyncState.lastSuccessAt })
      .from(schema.efinanceSyncState)
      .where(eq(schema.efinanceSyncState.feed, feed))
      .limit(1);
    return { cursor: row?.cursor ?? null, lastSuccessAt: row?.lastSuccessAt ?? null };
  }

  private async saveState(
    feed: Feed,
    outcome: { cursor: string | null; rows: number; error: string | null },
  ): Promise<void> {
    const now = new Date();
    const values = {
      cursor: outcome.cursor,
      lastRunAt: now,
      lastError: outcome.error,
      rows: outcome.rows,
      ...(outcome.error === null ? { lastSuccessAt: now } : {}),
    };
    await this.db()
      .insert(schema.efinanceSyncState)
      .values({ feed, ...values })
      .onConflictDoUpdate({ target: schema.efinanceSyncState.feed, set: values });
  }
}

/** A quantity or a rate as Postgres numeric text, or null when it is not a number. */
function numericOrNull(value: string | number | null): string | null {
  const parsed = toNumber(value);
  return parsed === null ? null : String(parsed);
}

/** A JS string array as a Postgres array literal, for `= any(...)`. */
function toPgArray(values: string[]): string {
  return `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}
