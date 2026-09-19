/**
 * The overrun sweep (R23, CAPEX-01 §6.5).
 *
 * «Permit is live only inside its window. Overrun flips it to breach and
 * notifies the head of estates and the area owner.»
 *
 * A permit that has run past its end is not a state anybody navigates to, so
 * nothing in a request can produce it. It is the clock that produces it, and
 * a clock in this system is a scheduled job (ADR-0023's shape, the same
 * `@nestjs/schedule` interval the eArchive sender runs on).
 *
 * Once a minute, because §6.5's notification is the point: a theatre that was
 * supposed to be back at 06:00 and is not has to reach the head of estates
 * while there is still a morning list to move, not in the nightly batch.
 *
 * It runs outside a request, so it has no caller and no row policy to run
 * under. It opens its own transaction with `app.user_id` set to
 * `scheduler:breach`, so the audit trigger records who flipped the permit —
 * R42 has no exception for something the server did to itself.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { PoolClient } from "pg";
import { CONFIG, type AppConfig } from "../config";
import { DatabaseService } from "../db/client";

export const BREACH_INTERVAL_MS = 60_000;

/** The actor the audit log records for a flip nobody asked for. */
export const BREACH_ACTOR = "scheduler:breach";

export interface BreachResult {
  breached: string[];
  emails: number;
}

@Injectable()
export class BreachService {
  private readonly logger = new Logger(BreachService.name);
  private sweeping = false;

  constructor(
    private readonly database: DatabaseService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Interval("ecapital.permits.breach", BREACH_INTERVAL_MS)
  async tick(): Promise<void> {
    // The tests drive `sweep` with a clock they control; a timer firing in
    // the middle of a test would flip permits the test is still setting up.
    if (this.config.NODE_ENV === "test") return;
    try {
      await this.sweep(new Date());
    } catch (error) {
      this.logger.error(`breach sweep failed: ${String(error)}`);
    }
  }

  /**
   * One pass, at a moment the caller chooses.
   *
   * The update and the emails share the transaction, so a permit cannot end
   * up flipped with nobody told, and nobody can be told about a flip that
   * rolled back.
   */
  async sweep(now: Date): Promise<BreachResult> {
    if (this.sweeping) return { breached: [], emails: 0 };
    this.sweeping = true;
    const client = await this.database.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [BREACH_ACTOR]);

      // The job has no roles, so every row policy on `shutdown_permit` refuses
      // it. It reaches the table through the two SECURITY DEFINER functions of
      // migration 0015 and through nothing else — ADR-0023's shape, and what
      // «service-only» means for a table whose access rule is clinical.
      const { rows: breached } = await client.query<BreachedRow>(
        "select id, ref, org_unit_id, title_el, planned_end from ecapital.flip_overrun_permits($1)",
        [now],
      );

      let emails = 0;
      for (const permit of breached) {
        emails += await this.notify(client, permit);
      }

      await client.query("commit");
      if (breached.length) {
        this.logger.warn(`permits in breach: ${breached.map((p) => p.ref ?? p.id).join(", ")}`);
      }
      return { breached: breached.map((p) => p.id), emails };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      this.sweeping = false;
    }
  }

  /**
   * §6.5: the head of estates and the area owner. Both, by name, because they
   * are the two people who can do something about it — one can send somebody,
   * the other has to decide what happens to the list.
   *
   * De-duplicated by the function that finds them: a head of estates who is
   * also the ward's clinical owner gets one email, not two.
   */
  private async notify(client: PoolClient, permit: BreachedRow): Promise<number> {
    const { rows } = await client.query<{ email: string; name: string }>(
      "select email, name from ecapital.permit_breach_recipients($1)",
      [permit.id],
    );

    const label = permit.ref ?? permit.id;
    const ended = permit.planned_end.toISOString();
    for (const row of rows) {
      await client.query(
        "select ecapital.queue_email($1, $2, $3, $4, $5, $6, $7, 'shutdown_permit', $8)",
        [
          permit.org_unit_id,
          row.email,
          row.name,
          `Υπέρβαση διακοπής: ${label}`,
          `Shutdown overrun: ${label}`,
          `Η άδεια εργασίας ${label} («${permit.title_el}») έληγε στις ${ended} και ο χώρος δεν έχει παραδοθεί. Ελέγξτε τον χώρο και κλείστε την άδεια.`,
          `Permit ${label} ("${permit.title_el}") was due to end at ${ended} and the area has not been handed back. Check the area and close the permit.`,
          permit.id,
        ],
      );
    }
    return rows.length;
  }
}

interface BreachedRow {
  id: string;
  ref: string | null;
  org_unit_id: string;
  title_el: string;
  planned_end: Date;
}
