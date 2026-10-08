/**
 * The maintenance sweep (R32, R33; ADR-0031 §3–4).
 *
 * «A month of PM work orders generate, dispatch and close without a
 * spreadsheet» needs a clock, and a clock in this system is a scheduled job
 * (the breach sweep's shape, the same `@nestjs/schedule` interval). Once an
 * hour it runs the pass «Έκδοση τώρα» runs: issue the PM orders that are
 * inside their lead time, and stamp the corrective calls whose response time
 * passed unanswered. Hourly is enough: the lead time is days, and the
 * escalation is a flag on the list, not a page to somebody's phone yet.
 *
 * It runs outside a request, so it has no caller. It opens its own
 * transaction with `app.user_id` set to `scheduler:maintenance`, so the
 * audit trigger records who issued the order and who stamped the call —
 * R42 has no exception for something the server did to itself — and with
 * the administrator's role, so the row policies decide what it may touch
 * exactly as they would for a person (ADR-0029 §6's service identity). The
 * orders it issues have no raiser and read «Σύστημα».
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { PmGenerationResult } from "@ecapital/shared";
import { CONFIG, type AppConfig } from "../config";
import { DatabaseService, type RlsContext } from "../db/client";
import { SchedulesService } from "./schedules.service";

export const MAINTENANCE_SWEEP_INTERVAL_MS = 3_600_000;

/** The actor the audit log records for an order nobody asked for. */
export const MAINTENANCE_ACTOR = "scheduler:maintenance";

const SWEEP_CONTEXT: RlsContext = Object.freeze({
  userId: MAINTENANCE_ACTOR,
  roles: ["admin"],
  orgUnitIds: [],
  ip: null,
  // ADR-0033: code, not a role — the matrix does not apply to it.
  system: true,
}) as RlsContext;

@Injectable()
export class MaintenanceSweepService {
  private readonly logger = new Logger(MaintenanceSweepService.name);
  private sweeping = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly schedules: SchedulesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Interval("ecapital.maintenance.sweep", MAINTENANCE_SWEEP_INTERVAL_MS)
  async tick(): Promise<void> {
    // The tests drive `sweep` with a clock they control; a timer firing in
    // the middle of a test would issue orders the test is still setting up.
    if (this.config.NODE_ENV === "test") return;
    try {
      await this.sweep(new Date());
    } catch (error) {
      this.logger.error(`maintenance sweep failed: ${String(error)}`);
    }
  }

  /**
   * One pass, at a moment the caller chooses, in one transaction: the orders,
   * the moved programme dates and the escalation stamps commit together or
   * not at all.
   */
  async sweep(now: Date): Promise<PmGenerationResult> {
    if (this.sweeping) return { generated: 0, skippedOpen: 0, escalated: 0 };
    this.sweeping = true;
    try {
      const result = await this.database.withRls(SWEEP_CONTEXT, () =>
        this.schedules.generate(now, null),
      );
      if (result.generated || result.escalated) {
        this.logger.log(
          `maintenance sweep: ${result.generated} PM orders issued, ${result.escalated} calls escalated`,
        );
      }
      return result;
    } finally {
      this.sweeping = false;
    }
  }
}
