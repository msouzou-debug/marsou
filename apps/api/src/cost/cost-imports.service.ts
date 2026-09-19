/**
 * R14 — the SAP import and the unmatched-allocation queue.
 *
 * CAPEX-01 §7: "The importer maps columns, matches on WBS then PO then cost
 * centre, writes `import_batch` and `cost_txn`, and presents an unmatched
 * queue for manual allocation — this queue is where the value is, so make it
 * fast: bulk-assign, remember previous allocations, suggest by supplier and
 * text similarity."
 *
 * The matching order is the one that sentence gives, with the remembered
 * rules last: a rule is somebody's judgement from last month, and a WBS, a
 * purchase order or a cost centre is a fact SAP is carrying this month.
 * Facts first.
 *
 * Nothing in this file knows what a file is. It asks a `CostSourceReader` for
 * rows (R15) and the reader it is handed decides where they come from.
 *
 * ADR-0010 still holds: there is no permission check in here. The row
 * policies decide who may allocate a row to which project, and an engineer
 * who tries to put a row on a project outside their units is refused by
 * Postgres and gets errors.readOnlyAccount back.
 */
import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  Allocation,
  CostTxn,
  ImportBatch,
  SapReport,
  Suggestion,
  UnmatchedQueue,
  UnmatchedRow,
} from "@ecapital/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import { INSUFFICIENT_PRIVILEGE, UNIQUE_VIOLATION, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import {
  type AllocationResult,
  type ImportBatchList,
  type ImportBatchResult,
  type ImportException,
  type ImportRequest,
} from "./cost-contracts";
import { type ImportBatchRow, money, round2, toCostTxn, toImportBatch } from "./cost-rows";
import { CostWarningsService } from "./cost-warnings.service";
import type { CostSourceReader, RawCostRow } from "./source/cost-source";
import { TXN_TYPE_BY_REPORT } from "./source/cost-source";
import { SapExtractReader } from "./source/sap-extract.reader";
import { SapMcpReader } from "./source/sap-mcp.reader";
import { loadSapProfile } from "./source/sap-profile";
import { normalise, ruleText } from "./text";

/** How many exceptions an answer carries. The rest are in the batch. */
const EXCEPTION_PAGE = 50;
/** S10 shows one to nine suggestions on a row (packages/shared `UnmatchedRow`). */
const MAX_SUGGESTIONS = 9;
/** Below this, a trigram match is a coincidence and not a suggestion. */
const SIMILARITY_FLOOR = 0.3;

interface MatchTarget {
  projectId: string | null;
  contractId: string | null;
  matchedBy: CostTxn["matchedBy"];
}

const NO_MATCH: MatchTarget = { projectId: null, contractId: null, matchedBy: "NONE" };

/** The lookup tables one import resolves its rows against, read once. */
interface MatchIndex {
  byWbs: { projectId: string; wbs: string }[];
  byPo: Map<string, { projectId: string; contractId: string }>;
  byCostCentre: Map<string, string>;
  rules: Map<string, { projectId: string; contractId: string | null; ruleId: string }>;
}

@Injectable()
export class CostImportsService {
  private readonly readers = new Map<string, CostSourceReader>([
    ["SAP_EXTRACT", new SapExtractReader()],
    // R15: present, registered, and without a server to talk to. The proof
    // that the seam is real is that the pipeline reaches it the same way.
    ["SAP_MCP", new SapMcpReader()],
  ]);

  constructor(
    private readonly i18n: I18nService,
    private readonly warnings: CostWarningsService,
  ) {}

  /**
   * R14. Read the extract, match every row, and either write the batch or —
   * the default, and the normal case — say what writing it would do.
   *
   * RULE (R14): the same file twice is a mistake and not an import. A file
   * whose hash is already on a batch for the same report answers 409. A dry
   * run is exempt, because reading the same file again is how somebody checks
   * what changed.
   */
  async import(
    request: ImportRequest,
    payload: { fileName: string; content: Buffer },
  ): Promise<ImportBatchResult> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const reader = this.readers.get("SAP_EXTRACT");
    if (!reader) throw AppError.internal();
    const profile = loadSapProfile(request.report);
    const sha256 = createHash("sha256").update(payload.content).digest("hex");

    if (!request.dryRun) {
      const already = await tx.db
        .select({ id: schema.importBatch.id })
        .from(schema.importBatch)
        .where(
          and(
            eq(schema.importBatch.fileSha256, sha256),
            eq(schema.importBatch.report, request.report),
            sql`${schema.importBatch.status} <> 'FAILED'`,
          ),
        )
        .limit(1);
      if (already.length) {
        throw AppError.conflict("errors.costImportDuplicate", { file: payload.fileName });
      }
    }

    const index = await this.matchIndex();
    const exceptions: ImportException[] = [];
    const matched: {
      row: RawCostRow;
      target: MatchTarget;
    }[] = [];

    let rowsIn = 0;
    let rowsRejected = 0;
    let amountIn = 0;

    for await (const row of reader.read({
      report: request.report,
      period: request.period,
      payload,
    })) {
      rowsIn += 1;
      if (row.problems.length || row.amount === null || row.postingDate === null) {
        rowsRejected += 1;
        for (const problem of row.problems) {
          exceptions.push({
            id: `${sha256.slice(0, 8)}:${row.rowNo}:${problem.rule}`,
            rule: problem.rule,
            severity: "ERROR",
            rowNo: row.rowNo,
            value: problem.value,
            messageEl: this.i18n.translate(problem.messageKey, "el", problem.params),
            messageEn: this.i18n.translate(problem.messageKey, "en", problem.params),
            costTxnId: null,
          });
        }
        continue;
      }
      amountIn = round2(amountIn + row.amount);
      matched.push({ row, target: this.matchOf(row, index) });
    }

    const rowsUnmatched = matched.filter((item) => item.target.projectId === null).length;
    const rowsMatched = matched.length - rowsUnmatched;
    const amountMatched = round2(
      matched
        .filter((item) => item.target.projectId !== null)
        .reduce((sum, item) => sum + (item.row.amount ?? 0), 0),
    );

    // RULE (R14): a batch with nothing left to allocate is finished. There is
    // no queue to work, so asking somebody to press «Ολοκλήρωση» on an empty
    // list would be ceremony.
    const status = rowsUnmatched === 0 ? "COMMITTED" : "PENDING_ALLOCATION";

    if (request.dryRun) {
      return {
        ...this.dryRunBatch({
          sha256,
          fileName: payload.fileName,
          profileId: profile.profile,
          report: request.report,
          period: request.period,
          rowsIn,
          rowsMatched,
          rowsUnmatched,
          rowsRejected,
          amountIn,
          amountMatched,
          importedByName: await this.callerName(),
        }),
        exceptions: [...exceptions, ...this.unmatchedExceptions(matched)].slice(
          0,
          EXCEPTION_PAGE,
        ),
      };
    }

    const caller = await callerUserId();
    let batchId: string;
    try {
      const [batch] = await tx.db
        .insert(schema.importBatch)
        .values({
          source: "SAP_EXTRACT",
          report: request.report,
          fileName: payload.fileName,
          fileSha256: sha256,
          profileId: profile.profile,
          period: request.period,
          rowsIn,
          rowsMatched,
          rowsUnmatched,
          rowsRejected,
          amountIn: String(amountIn),
          amountMatched: String(amountMatched),
          status,
          importedBy: tx.context.userId,
          importedById: caller,
        })
        .returning({ id: schema.importBatch.id });
      batchId = batch.id;
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      if (sqlState(error) === UNIQUE_VIOLATION) {
        throw AppError.conflict("errors.costImportDuplicate", { file: payload.fileName });
      }
      throw error;
    }

    const txnType = TXN_TYPE_BY_REPORT[request.report];
    const values = matched.map((item) => ({
      // The trigger fills this from the project where there is one; a row
      // with no project belongs to no unit until somebody allocates it.
      orgUnitId: null,
      projectId: item.target.projectId,
      contractId: item.target.contractId,
      txnType,
      source: "SAP_EXTRACT" as const,
      sourceRef: `${item.row.sourceRef}#${item.row.rowNo}`,
      docDate: item.row.docDate,
      postingDate: item.row.postingDate,
      amount: String(item.row.amount),
      description: item.row.description,
      vendorName: item.row.vendorName,
      sapWbs: item.row.sapWbs,
      sapPo: item.row.sapPo,
      costCentre: item.row.costCentre,
      glAccount: item.row.glAccount,
      importBatchId: batchId,
      matchedBy: item.target.matchedBy,
    }));

    for (let at = 0; at < values.length; at += 500) {
      try {
        await tx.db.insert(schema.costTxn).values(values.slice(at, at + 500));
      } catch (error) {
        if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
          throw AppError.forbidden("errors.readOnlyAccount");
        }
        throw error;
      }
    }

    if (exceptions.length) {
      await tx.db.insert(schema.importException).values(
        exceptions.map((exception) => ({
          batchId,
          rule: exception.rule,
          severity: exception.severity,
          rowNo: exception.rowNo,
          value: exception.value,
          messageEl: exception.messageEl,
          messageEn: exception.messageEn,
        })),
      );
    }

    // R31 on every project the import touched: a month of commitments can
    // take a project past its year's budget line, and that is exactly the
    // moment somebody should hear about it.
    if (status === "COMMITTED") await this.evaluateTouched(batchId);

    return this.detail(batchId);
  }

  async list(): Promise<ImportBatchList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select(BATCH_COLUMNS)
      .from(schema.importBatch)
      .where(sql`${schema.importBatch.report} is not null`)
      .orderBy(desc(schema.importBatch.importedAt));
    const items = rows.map((row) => toImportBatch(row as ImportBatchRow));
    return { items, total: items.length };
  }

  async detail(id: string): Promise<ImportBatchResult> {
    const batch = await this.load(id);
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const stored = await tx.db
      .select({
        id: schema.importException.id,
        rule: schema.importException.rule,
        severity: schema.importException.severity,
        rowNo: schema.importException.rowNo,
        value: schema.importException.value,
        messageEl: schema.importException.messageEl,
        messageEn: schema.importException.messageEn,
        costTxnId: schema.importException.costTxnId,
      })
      .from(schema.importException)
      .where(eq(schema.importException.batchId, id))
      .orderBy(asc(schema.importException.rowNo))
      .limit(EXCEPTION_PAGE);

    return { ...toImportBatch(batch), exceptions: stored as ImportException[] };
  }

  /**
   * R14, S10 — the queue. One row, up to nine suggestions, best first.
   *
   * The order of the reasons is the order of the evidence: the same WBS or
   * the same purchase order is near-certain, the same cost centre or a vendor
   * somebody has allocated before is likely, and a similar narrative is a
   * hint. The interface shows the reason as text so nobody has to guess what
   * the ranking meant.
   */
  async unmatched(batchId: string, limit = 25): Promise<UnmatchedQueue> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(batchId);

    const [counts] = await tx.db
      .select({
        remaining: sql<number>`count(*) filter (where ${schema.costTxn.skipped} = false)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.costTxn)
      .where(
        and(eq(schema.costTxn.importBatchId, batchId), isNull(schema.costTxn.projectId)),
      );

    const rows = await tx.db
      .select(TXN_COLUMNS)
      .from(schema.costTxn)
      .where(
        and(
          eq(schema.costTxn.importBatchId, batchId),
          isNull(schema.costTxn.projectId),
          eq(schema.costTxn.skipped, false),
        ),
      )
      .orderBy(desc(sql`abs(${schema.costTxn.amount})`), asc(schema.costTxn.sourceRef))
      .limit(limit);

    const items: UnmatchedRow[] = [];
    for (const row of rows) {
      const txn = toCostTxn(row);
      items.push({ txn, suggestions: await this.suggestionsFor(txn) });
    }

    return {
      batchId,
      remaining: counts?.remaining ?? 0,
      total: counts?.total ?? 0,
      items,
    };
  }

  /**
   * R14. Put the rows on a project, and — unless somebody says not to —
   * remember what was decided so next month's extract matches itself.
   *
   * RULE (packages/shared `Allocation`): `remember` defaults to true, and a
   * remembered allocation comes back as matchedBy RULE rather than MANUAL,
   * because that is what it will be on every row after this one.
   */
  async allocate(batchId: string, input: Allocation): Promise<AllocationResult> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(batchId);

    const project = await this.projectOf(input.projectId);
    if (input.contractId) await this.contractOf(input.contractId, input.projectId);

    const rows = await tx.db
      .select({
        id: schema.costTxn.id,
        vendorName: schema.costTxn.vendorName,
        description: schema.costTxn.description,
      })
      .from(schema.costTxn)
      .where(
        and(
          eq(schema.costTxn.importBatchId, batchId),
          inArray(schema.costTxn.id, input.txnIds),
          isNull(schema.costTxn.projectId),
        ),
      );
    if (!rows.length) throw AppError.notFound("errors.costTxnNotFound");

    const matchedBy = input.remember ? "RULE" : "MANUAL";
    try {
      await tx.db
        .update(schema.costTxn)
        .set({
          projectId: input.projectId,
          contractId: input.contractId,
          matchedBy,
          skipped: false,
          updatedAt: sql`now()`,
        })
        .where(inArray(schema.costTxn.id, rows.map((row) => row.id)));
    } catch (error) {
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }

    if (input.remember) {
      const caller = await callerUserId();
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row.vendorName) continue;
        const vendorNorm = normalise(row.vendorName);
        const textNorm = ruleText(row.description);
        const key = `${vendorNorm}|${textNorm}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.db
          .insert(schema.allocationRule)
          .values({
            orgUnitId: project.orgUnitId,
            projectId: input.projectId,
            contractId: input.contractId,
            vendorName: row.vendorName,
            vendorNorm,
            textNorm,
            createdBy: caller,
          })
          .onConflictDoUpdate({
            target: [schema.allocationRule.vendorNorm, schema.allocationRule.textNorm],
            set: {
              projectId: input.projectId,
              contractId: input.contractId,
              hits: sql`${schema.allocationRule.hits} + 1`,
              updatedAt: sql`now()`,
            },
          });
      }
    }

    await tx.db.execute(sql`select ecapital.refresh_import_batch_counts(${batchId}::uuid)`);
    // R31: the project has just been given money it did not have a moment ago.
    await this.warnings.evaluate(input.projectId);

    const queue = await this.unmatched(batchId, 1);
    return { remaining: queue.remaining, next: queue.items[0] ?? null };
  }

  /**
   * R14. Pass over a row without deciding: it stays unmatched, it stays in
   * the batch, and the queue stops offering it so the next one can be dealt
   * with. Skipping is not rejecting — the row is still in the file and still
   * in the reconciliation.
   */
  async skip(batchId: string, txnIds: string[]): Promise<AllocationResult> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.load(batchId);

    try {
      const touched = await tx.db
        .update(schema.costTxn)
        .set({ skipped: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.costTxn.importBatchId, batchId),
            inArray(schema.costTxn.id, txnIds),
            isNull(schema.costTxn.projectId),
          ),
        )
        .returning({ id: schema.costTxn.id });
      if (!touched.length) throw AppError.notFound("errors.costTxnNotFound");
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }

    const queue = await this.unmatched(batchId, 1);
    return { remaining: queue.remaining, next: queue.items[0] ?? null };
  }

  /**
   * R14. Close the batch. Whatever is still unmatched was skipped on purpose,
   * and each skipped row becomes an entry in the exceptions list so the
   * reconciliation says what was left and who left it.
   */
  async commit(batchId: string): Promise<ImportBatchResult> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const batch = await this.load(batchId);
    if (batch.status === "COMMITTED") return this.detail(batchId);

    const leftovers = await tx.db
      .select({
        id: schema.costTxn.id,
        sourceRef: schema.costTxn.sourceRef,
        amount: schema.costTxn.amount,
        description: schema.costTxn.description,
      })
      .from(schema.costTxn)
      .where(
        and(eq(schema.costTxn.importBatchId, batchId), isNull(schema.costTxn.projectId)),
      );

    try {
      if (leftovers.length) {
        await tx.db.delete(schema.importException).where(
          and(
            eq(schema.importException.batchId, batchId),
            eq(schema.importException.rule, "SKIPPED"),
          ),
        );
        await tx.db.insert(schema.importException).values(
          leftovers.map((row) => {
            const params = {
              ref: row.sourceRef ?? "",
              amount: String(money(row.amount)),
              text: row.description ?? "",
            };
            return {
              batchId,
              rule: "SKIPPED",
              severity: "WARN" as const,
              rowNo: null,
              value: row.sourceRef,
              messageEl: this.i18n.translate("import.cost.skipped", "el", params),
              messageEn: this.i18n.translate("import.cost.skipped", "en", params),
              costTxnId: row.id,
            };
          }),
        );
      }

      const touched = await tx.db
        .update(schema.importBatch)
        .set({ status: "COMMITTED", updatedAt: sql`now()` })
        .where(eq(schema.importBatch.id, batchId))
        .returning({ id: schema.importBatch.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }

    await tx.db.execute(sql`select ecapital.refresh_import_batch_counts(${batchId}::uuid)`);
    await this.evaluateTouched(batchId);
    return this.detail(batchId);
  }

  // ------------------------------------------------------------- matching --

  /**
   * RULE (CAPEX-01 §7, R14): WBS, then purchase order, then cost centre, then
   * what somebody decided last month. A WBS element names the project
   * outright. A purchase order names the contract, and the contract names the
   * project. A cost centre names the unit's project where one carries it. A
   * remembered rule is a judgement, and a judgement yields to a fact.
   */
  private matchOf(row: RawCostRow, index: MatchIndex): MatchTarget {
    if (row.sapWbs) {
      const wbs = row.sapWbs.trim().toUpperCase();
      // SAP hangs sub-elements off a WBS — «C-2026-014.2» under
      // «C-2026-014» — and the posting carries the leaf. An exact match
      // first, then the longest prefix that ends on a separator.
      const exact = index.byWbs.find((entry) => entry.wbs === wbs);
      if (exact) return { projectId: exact.projectId, contractId: null, matchedBy: "WBS" };
      const prefixed = index.byWbs
        .filter((entry) => wbs.startsWith(entry.wbs) && /[^A-Z0-9]/.test(wbs[entry.wbs.length] ?? ""))
        .sort((a, b) => b.wbs.length - a.wbs.length)[0];
      if (prefixed) return { projectId: prefixed.projectId, contractId: null, matchedBy: "WBS" };
    }

    if (row.sapPo) {
      const po = index.byPo.get(row.sapPo.trim().toUpperCase());
      if (po) return { projectId: po.projectId, contractId: po.contractId, matchedBy: "PO" };
    }

    if (row.costCentre) {
      const projectId = index.byCostCentre.get(row.costCentre.trim().toUpperCase());
      if (projectId) return { projectId, contractId: null, matchedBy: "COST_CENTRE" };
    }

    if (row.vendorName) {
      const vendor = normalise(row.vendorName);
      const text = ruleText(row.description);
      const rule = index.rules.get(`${vendor}|${text}`) ?? index.rules.get(`${vendor}|`);
      if (rule) {
        return { projectId: rule.projectId, contractId: rule.contractId, matchedBy: "RULE" };
      }
    }

    return NO_MATCH;
  }

  /** The four lookups, read once per import rather than once per row. */
  private async matchIndex(): Promise<MatchIndex> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const [projects, contracts, rules] = await Promise.all([
      tx.db
        .select({
          id: schema.project.id,
          sapWbs: schema.project.sapWbs,
          costCentre: schema.project.costCentre,
        })
        .from(schema.project),
      tx.db
        .select({
          id: schema.contract.id,
          projectId: schema.contract.projectId,
          sapPoNumber: schema.contract.sapPoNumber,
        })
        .from(schema.contract),
      tx.db
        .select({
          id: schema.allocationRule.id,
          projectId: schema.allocationRule.projectId,
          contractId: schema.allocationRule.contractId,
          vendorNorm: schema.allocationRule.vendorNorm,
          textNorm: schema.allocationRule.textNorm,
        })
        .from(schema.allocationRule),
    ]);

    const byWbs = projects
      .filter((row) => row.sapWbs)
      .map((row) => ({ projectId: row.id, wbs: (row.sapWbs as string).trim().toUpperCase() }));

    const byCostCentre = new Map<string, string>();
    for (const row of projects) {
      if (row.costCentre) byCostCentre.set(row.costCentre.trim().toUpperCase(), row.id);
    }

    const byPo = new Map<string, { projectId: string; contractId: string }>();
    for (const row of contracts) {
      if (row.sapPoNumber) {
        byPo.set(row.sapPoNumber.trim().toUpperCase(), {
          projectId: row.projectId,
          contractId: row.id,
        });
      }
    }

    const ruleMap = new Map<string, { projectId: string; contractId: string | null; ruleId: string }>();
    for (const rule of rules) {
      ruleMap.set(`${rule.vendorNorm}|${rule.textNorm}`, {
        projectId: rule.projectId,
        contractId: rule.contractId,
        ruleId: rule.id,
      });
    }

    return { byWbs, byPo, byCostCentre, rules: ruleMap };
  }

  /**
   * R14, S10. Up to nine, ordered by how much evidence is behind them:
   * the same WBS, the same purchase order, the same cost centre, a vendor
   * somebody has allocated before, and finally a narrative that reads like
   * one already in the register.
   */
  private async suggestionsFor(txn: CostTxn): Promise<Suggestion[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const wbs = txn.sapWbs ? txn.sapWbs.trim() : "";
    const po = txn.sapPo ? txn.sapPo.trim() : "";
    const costCentre = txn.costCentre ? txn.costCentre.trim() : "";
    const vendor = txn.vendorName ? normalise(txn.vendorName) : "";
    const text = txn.description ? normalise(txn.description) : "";

    const result = await tx.db.execute<{
      project_id: string;
      project_code: string;
      project_title_el: string;
      contract_id: string | null;
      contract_ref: string | null;
      reason: Suggestion["reason"];
      confidence: Suggestion["confidence"];
      rank: number;
      score: number;
    }>(sql`
      with wbs_match as (
        select p.id as project_id, p.code as project_code, p.title_el as project_title_el,
               null::uuid as contract_id, null::text as contract_ref,
               'SAME_WBS' as reason, 'HIGH' as confidence, 1 as rank, 1.0::float8 as score
          from ecapital.project p
         where ${wbs}::text <> '' and p.sap_wbs is not null
           and (upper(p.sap_wbs) = upper(${wbs}::text) or upper(${wbs}::text) like upper(p.sap_wbs) || '.%')
         limit 3),
      po_match as (
        select p.id, p.code, p.title_el, c.id, c.ref,
               'SAME_PO', 'HIGH', 2, 1.0::float8
          from ecapital.contract c join ecapital.project p on p.id = c.project_id
         where ${po}::text <> '' and c.sap_po_number is not null
           and upper(c.sap_po_number) = upper(${po}::text)
         limit 3),
      cc_match as (
        select p.id, p.code, p.title_el, null::uuid, null::text,
               'SAME_COST_CENTRE', 'MEDIUM', 3, 0.8::float8
          from ecapital.project p
         where ${costCentre}::text <> '' and p.cost_centre is not null
           and upper(p.cost_centre) = upper(${costCentre}::text)
         limit 3),
      vendor_match as (
        select p.id, p.code, p.title_el, r.contract_id, c.ref,
               'REMEMBERED_VENDOR', 'MEDIUM', 4, 0.7::float8
          from ecapital.allocation_rule r
          join ecapital.project p on p.id = r.project_id
          left join ecapital.contract c on c.id = r.contract_id
         where ${vendor}::text <> '' and r.vendor_norm = ${vendor}::text
         order by r.hits desc
         limit 3),
      text_match as (
        select p.id, p.code, p.title_el, null::uuid, null::text,
               'SIMILAR_TEXT', 'LOW', 5,
               similarity(ecapital.normalise(p.title_el), ${text}::text)::float8
          from ecapital.project p
         where ${text}::text <> ''
           and similarity(ecapital.normalise(p.title_el), ${text}::text) >= ${SIMILARITY_FLOOR}::float8
         order by similarity(ecapital.normalise(p.title_el), ${text}::text) desc
         limit 3)
      select * from wbs_match
      union all select * from po_match
      union all select * from cc_match
      union all select * from vendor_match
      union all select * from text_match`);

    const seen = new Set<string>();
    const suggestions: Suggestion[] = [];
    for (const row of [...result.rows].sort((a, b) => a.rank - b.rank || b.score - a.score)) {
      const key = `${row.project_id}:${row.contract_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({
        projectId: row.project_id,
        projectCode: row.project_code,
        projectTitleEl: row.project_title_el,
        contractId: row.contract_id,
        contractRef: row.contract_ref,
        confidence: row.confidence,
        reason: row.reason,
      });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    return suggestions;
  }

  // ------------------------------------------------------------ internals --

  private unmatchedExceptions(
    matched: { row: RawCostRow; target: MatchTarget }[],
  ): ImportException[] {
    return matched
      .filter((item) => item.target.projectId === null)
      .map((item) => {
        const params = {
          ref: item.row.sourceRef,
          amount: String(item.row.amount ?? 0),
          text: item.row.description,
        };
        return {
          id: `unmatched:${item.row.rowNo}`,
          rule: "UNMATCHED",
          severity: "WARN" as const,
          rowNo: item.row.rowNo,
          value: item.row.sourceRef,
          messageEl: this.i18n.translate("import.cost.unmatched", "el", params),
          messageEn: this.i18n.translate("import.cost.unmatched", "en", params),
          costTxnId: null,
        };
      });
  }

  /**
   * The summary of a run that wrote nothing. It carries no id from the
   * database because there is no row; the hash is what identifies the file,
   * and re-running the same dry run answers the same thing.
   */
  private dryRunBatch(input: {
    sha256: string;
    fileName: string;
    profileId: string;
    report: SapReport;
    period: string;
    rowsIn: number;
    rowsMatched: number;
    rowsUnmatched: number;
    rowsRejected: number;
    amountIn: number;
    amountMatched: number;
    importedByName: string;
  }): ImportBatch {
    return {
      id: `dry-run:${input.sha256.slice(0, 12)}`,
      source: "SAP_EXTRACT",
      report: input.report,
      fileName: input.fileName,
      fileSha256: input.sha256,
      profileId: input.profileId,
      period: input.period,
      rowsIn: input.rowsIn,
      rowsMatched: input.rowsMatched,
      rowsUnmatched: input.rowsUnmatched,
      rowsRejected: input.rowsRejected,
      amountIn: input.amountIn,
      amountMatched: input.amountMatched,
      status: "DRY_RUN",
      importedById: "",
      importedByName: input.importedByName,
      importedAt: new Date().toISOString(),
      errorEl: null,
      errorEn: null,
    };
  }

  private async evaluateTouched(batchId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .selectDistinct({ projectId: schema.costTxn.projectId })
      .from(schema.costTxn)
      .where(
        and(eq(schema.costTxn.importBatchId, batchId), sql`${schema.costTxn.projectId} is not null`),
      );
    for (const row of rows) {
      if (row.projectId) await this.warnings.evaluate(row.projectId);
    }
  }

  private async load(id: string): Promise<ImportBatchRow> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.costImportNotFound");
    const rows = await tx.db
      .select(BATCH_COLUMNS)
      .from(schema.importBatch)
      .where(eq(schema.importBatch.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.costImportNotFound");
    return rows[0] as ImportBatchRow;
  }

  private async projectOf(id: string): Promise<{ id: string; orgUnitId: string }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.projectNotFound");
    const rows = await tx.db
      .select({ id: schema.project.id, orgUnitId: schema.project.orgUnitId })
      .from(schema.project)
      .where(eq(schema.project.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.projectNotFound");
    return rows[0];
  }

  private async contractOf(id: string, projectId: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.contractNotFound");
    const rows = await tx.db
      .select({ id: schema.contract.id })
      .from(schema.contract)
      .where(and(eq(schema.contract.id, id), eq(schema.contract.projectId, projectId)))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractNotFound");
  }

  private async callerName(): Promise<string> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select({ name: schema.appUser.name })
      .from(schema.appUser)
      .where(eq(schema.appUser.subject, tx.context.userId))
      .limit(1);
    return rows[0]?.name ?? "";
  }
}

const BATCH_COLUMNS = {
  id: schema.importBatch.id,
  source: schema.importBatch.source,
  report: schema.importBatch.report,
  fileName: schema.importBatch.fileName,
  fileSha256: schema.importBatch.fileSha256,
  profileId: schema.importBatch.profileId,
  period: schema.importBatch.period,
  rowsIn: schema.importBatch.rowsIn,
  rowsMatched: schema.importBatch.rowsMatched,
  rowsUnmatched: schema.importBatch.rowsUnmatched,
  rowsRejected: schema.importBatch.rowsRejected,
  amountIn: schema.importBatch.amountIn,
  amountMatched: schema.importBatch.amountMatched,
  status: schema.importBatch.status,
  importedById: schema.importBatch.importedById,
  importedByName: sql<string | null>`ecapital.user_display_name(${schema.importBatch.importedById})`,
  importedAt: schema.importBatch.importedAt,
  errorEl: schema.importBatch.errorEl,
  errorEn: schema.importBatch.errorEn,
};

const TXN_COLUMNS = {
  id: schema.costTxn.id,
  orgUnitId: schema.costTxn.orgUnitId,
  projectId: schema.costTxn.projectId,
  contractId: schema.costTxn.contractId,
  budgetLineId: schema.costTxn.budgetLineId,
  txnType: schema.costTxn.txnType,
  source: schema.costTxn.source,
  sourceRef: schema.costTxn.sourceRef,
  docDate: schema.costTxn.docDate,
  postingDate: schema.costTxn.postingDate,
  amount: schema.costTxn.amount,
  description: schema.costTxn.description,
  vendorName: schema.costTxn.vendorName,
  sapWbs: schema.costTxn.sapWbs,
  sapPo: schema.costTxn.sapPo,
  costCentre: schema.costTxn.costCentre,
  glAccount: schema.costTxn.glAccount,
  importBatchId: schema.costTxn.importBatchId,
  matchedBy: schema.costTxn.matchedBy,
};
