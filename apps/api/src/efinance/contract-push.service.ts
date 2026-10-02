/**
 * The contract push — record §4, the one write, and the first thing the
 * eFinance client does: eFinance's invoice and requisition screens can only
 * be tagged with a CAP- reference eCapital has pushed, so until a contract
 * arrives every read answers an empty list (INTEGRATION §5, ADR-0029 §2).
 *
 * When it pushes:
 *   - a contract is recorded (ContractsService.create);
 *   - a contract is changed — its budget code among the rest (update);
 *   - a variation is approved, which is the only thing that moves the value
 *     (decideVariation, ADR-0015);
 *   - its project changes phase or title, which is where `status` and
 *     `title` come from (ProjectsService);
 *   - its contractor's SAP vendor code changes (ContractorsService).
 *
 * Each of those is one synchronous attempt inside the caller's request. It
 * never fails the request: whatever eFinance answers is written on the
 * contract (`efinance_last_error`), and a timer tries again every ten minutes
 * for anything that has not gone. Two answers are not retried by the timer:
 *
 *   - 409 CONFLICT: the reference already exists under another hospital or
 *     budget code. A silent retry would never succeed and a silent overwrite
 *     is exactly what eFinance refuses it to prevent. It becomes the
 *     contract warning `efinanceConflict` and a person resolves it.
 *   - a contract with no budget code, or whose contractor has no SAP vendor
 *     code, is not pushed at all; the contract carries `efinanceNotPushable`
 *     saying which.
 *
 * With EFINANCE_TOKEN not placed, nothing is attempted and nothing is
 * written: the contracts wait, and the first timer pass after the token
 * lands pushes every one of them (a contract never accepted has
 * `efinance_pushed_at` null, which is what "pending" means).
 */
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { EFinanceContractPut } from "@ecapital/shared";
import { sql } from "drizzle-orm";
import { CONFIG, type AppConfig } from "../config";
import { DatabaseService, currentTx } from "../db/client";
import { EFINANCE_CLIENT, EFINANCE_SYSTEM_CONTEXT } from "./efinance-context";
import { EFinanceClient, EFinanceError, isoUtc, toMoneyString } from "./efinance-client";
import { spendJson } from "./efinance-rows";

export const PUSH_RETRY_INTERVAL_MS = 10 * 60_000;
/** How many pending contracts one timer pass takes. */
const RETRY_BATCH = 100;

export type MissingField = "budgetCode" | "vendorCode";

export type PushOutcome =
  | { outcome: "pushed" }
  | { outcome: "not-configured" }
  | { outcome: "not-found" }
  | { outcome: "not-pushable"; missing: MissingField[] }
  | { outcome: "conflict"; error: string }
  | { outcome: "failed"; error: string };

interface PushFacts {
  id: string;
  ref: string;
  body: EFinanceContractPut | null;
  missing: MissingField[];
}

type FactsRow = {
  id: string;
  ref: string;
  current_value: string;
  budget_code: string | null;
  project_code: string;
  project_title: string;
  project_phase: string;
  unit_code: string;
  vendor_code: string | null;
  changed_at: Date | string;
};

@Injectable()
export class ContractPushService implements OnModuleInit {
  private readonly logger = new Logger(ContractPushService.name);
  private retrying = false;

  constructor(
    @Inject(EFINANCE_CLIENT) private readonly client: EFinanceClient,
    private readonly database: DatabaseService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Token placed AND the push switch on (EFINANCE_PUSH_ENABLED). Reads do not look here. */
  get configured(): boolean {
    return this.client.configured && this.config.EFINANCE_PUSH_ENABLED === true;
  }

  /** The token is there but the switch is off: the reason a manual push is refused with 409. */
  get pushDisabled(): boolean {
    return this.client.configured && this.config.EFINANCE_PUSH_ENABLED !== true;
  }

  onModuleInit(): void {
    if (!this.client.configured) {
      this.logger.warn(
        "eFinance is not configured (EFINANCE_TOKEN). Contracts are not pushed and nothing is read; both start when the token is placed and the unit restarted.",
      );
    } else if (this.pushDisabled) {
      this.logger.warn(
        "eFinance push is OFF (EFINANCE_PUSH_ENABLED is not 1). Invoices, requisitions and the budget position are read; contracts are not sent to eFinance until the switch is turned on and the unit restarted.",
      );
    }
  }

  /**
   * What the PUT would carry, read through the caller's own transaction (so a
   * contract the caller may not see is not pushed by them), or which of the
   * two fields it cannot be built without.
   *
   * RULE (record §4, ADR-0029):
   *   cap_ref       contract.ref, CAP-YYYY-NNNN, never edited
   *   project_ref   project.code
   *   title         project.title_el (a contract carries no title of its own)
   *   entity_code   org_unit.code — eArchive's form; eFinance translates
   *   budget_code   contract.budget_code (ADR-0025)
   *   vendor_code   contractor.sap_vendor_id
   *   current_value contract.current_value as a 2-decimal string
   *   status        closed when the project is CLOSED, active otherwise
   *   updated_at    the newest of the contract's, the project's and the
   *                 contractor's own updated_at, ISO with +00:00
   */
  async facts(contractId: string): Promise<PushFacts | null> {
    const tx = currentTx();
    if (!tx) throw new Error("ContractPushService.facts outside a transaction");
    const result = await tx.db.execute<FactsRow>(sql`
      select c.id, c.ref, c.current_value::text as current_value, c.budget_code,
             p.code as project_code, p.title_el as project_title, p.phase::text as project_phase,
             o.code as unit_code,
             nullif(trim(v.sap_vendor_id), '') as vendor_code,
             greatest(c.updated_at, p.updated_at, v.updated_at) as changed_at
        from ecapital.contract c
        join ecapital.project p on p.id = c.project_id
        join ecapital.org_unit o on o.id = c.org_unit_id
        join ecapital.contractor v on v.id = c.contractor_id
       where c.id = ${contractId}::uuid`);
    const row = result.rows[0];
    if (!row) return null;

    const missing: MissingField[] = [];
    if (!row.budget_code) missing.push("budgetCode");
    if (!row.vendor_code) missing.push("vendorCode");
    if (missing.length) return { id: row.id, ref: row.ref, body: null, missing };

    return {
      id: row.id,
      ref: row.ref,
      missing,
      body: {
        project_ref: row.project_code,
        title: row.project_title,
        entity_code: row.unit_code,
        budget_code: row.budget_code as string,
        vendor_code: row.vendor_code as string,
        current_value: toMoneyString(row.current_value),
        status: row.project_phase === "CLOSED" ? "closed" : "active",
        updated_at: isoUtc(new Date(row.changed_at)),
      },
    };
  }

  /**
   * One attempt, inside the current transaction. Never throws for anything
   * eFinance answers; the outcome is returned and written on the contract.
   */
  async push(contractId: string): Promise<PushOutcome> {
    if (!this.configured) return { outcome: "not-configured" };
    const tx = currentTx();
    if (!tx) throw new Error("ContractPushService.push outside a transaction");

    const facts = await this.facts(contractId);
    if (!facts) return { outcome: "not-found" };
    if (!facts.body) return { outcome: "not-pushable", missing: facts.missing };

    try {
      const answer = await this.client.putContract(facts.ref, facts.body);
      await tx.db.execute(
        sql`select ecapital.efinance_record_push(${facts.id}::uuid, true, null, ${JSON.stringify(spendJson(answer))}::jsonb)`,
      );
      return { outcome: "pushed" };
    } catch (error) {
      if (!(error instanceof EFinanceError)) throw error;
      await tx.db.execute(
        sql`select ecapital.efinance_record_push(${facts.id}::uuid, false, ${error.summary}::text, null)`,
      );
      this.logger.warn(`efinance push ${facts.ref}: ${error.summary}`);
      return error.code === "CONFLICT"
        ? { outcome: "conflict", error: error.summary }
        : { outcome: "failed", error: error.summary };
    }
  }

  /**
   * The hooks' entry point: the same attempt, and nothing it does — not even
   * a database error writing the outcome — can fail the change that called
   * it. The timer is the safety net.
   */
  async pushQuietly(contractIds: string | string[]): Promise<void> {
    if (!this.configured) return;
    const tx = currentTx();
    if (!tx) return;
    for (const id of Array.isArray(contractIds) ? contractIds : [contractIds]) {
      // A savepoint, so a database error while writing the outcome rolls back
      // only the outcome and leaves the caller's transaction usable.
      await tx.db.execute(sql`savepoint efinance_push`);
      try {
        await this.push(id);
        await tx.db.execute(sql`release savepoint efinance_push`);
      } catch (error) {
        await tx.db.execute(sql`rollback to savepoint efinance_push`).catch(() => undefined);
        this.logger.error(`efinance push of contract ${id} did not complete: ${messageOf(error)}`);
      }
    }
  }

  /** Every contract of a project the caller can see: its phase or title moved. */
  async pushProject(projectId: string): Promise<void> {
    if (!this.configured) return;
    const tx = currentTx();
    if (!tx) return;
    const rows = await tx.db.execute<{ id: string }>(
      sql`select id from ecapital.contract where project_id = ${projectId}::uuid order by ref`,
    );
    await this.pushQuietly(rows.rows.map((row) => row.id));
  }

  /** Every contract of a contractor the caller can see: its vendor code moved. */
  async pushContractor(contractorId: string): Promise<void> {
    if (!this.configured) return;
    const tx = currentTx();
    if (!tx) return;
    const rows = await tx.db.execute<{ id: string }>(
      sql`select id from ecapital.contract where contractor_id = ${contractorId}::uuid order by ref`,
    );
    await this.pushQuietly(rows.rows.map((row) => row.id));
  }

  // --------------------------------------------------------------- timer --

  @Interval("ecapital.efinance.push", PUSH_RETRY_INTERVAL_MS)
  async retryTick(): Promise<void> {
    if (this.config.NODE_ENV === "test") return;
    await this.retryPending();
  }

  /**
   * Everything that has not gone: never accepted, accepted before its last
   * change, or failed last time — except a CONFLICT, which waits for a
   * person, and a contract that cannot be built, which waits for its
   * missing field. Each one in its own transaction under the service
   * identity, so one slow answer does not hold the others' locks.
   */
  async retryPending(limit = RETRY_BATCH): Promise<{ tried: number; pushed: number }> {
    if (!this.configured || this.retrying) return { tried: 0, pushed: 0 };
    this.retrying = true;
    try {
      const ids = await this.database.withRls(EFINANCE_SYSTEM_CONTEXT, async (db) => {
        const result = await db.execute<{ id: string }>(sql`
          select c.id
            from ecapital.contract c
            join ecapital.project p on p.id = c.project_id
            join ecapital.contractor v on v.id = c.contractor_id
           where c.budget_code is not null
             and nullif(trim(v.sap_vendor_id), '') is not null
             and coalesce(c.efinance_last_error, '') not like 'CONFLICT%'
             and (c.efinance_pushed_at is null
                  or c.efinance_last_error is not null
                  or c.efinance_pushed_at < greatest(c.updated_at, p.updated_at, v.updated_at))
           order by c.updated_at
           limit ${limit}`);
        return result.rows.map((row) => row.id);
      });

      let pushed = 0;
      for (const id of ids) {
        try {
          const outcome = await this.database.withRls(EFINANCE_SYSTEM_CONTEXT, () => this.push(id));
          if (outcome.outcome === "pushed") pushed += 1;
        } catch (error) {
          this.logger.error(`efinance retry of contract ${id} did not complete: ${messageOf(error)}`);
        }
      }
      if (ids.length) this.logger.log(`efinance push retry: ${pushed} of ${ids.length} accepted`);
      return { tried: ids.length, pushed };
    } finally {
      this.retrying = false;
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
