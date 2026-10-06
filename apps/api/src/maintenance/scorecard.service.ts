/**
 * M5 — Αξιολόγηση αναδόχων, the contractor scorecard (R37, ADR-0031 §9).
 *
 * Reads the agreement and the orders the period touches, and hands them to
 * the pure `computeScorecard` — or, for the workbook, to the export that
 * writes the same arithmetic as live formulas. Nothing is stored: the
 * figures are the orders, read now.
 *
 * Penalty rates come from each order's catalogue line as it stands today.
 * The deadlines are the order's own (stamped at the call), so a later
 * change of a line's hours never moves a past order's lateness; a later
 * change of its rate does change the euro figure, which is the point of
 * typing the missing Nicosia rates in when the owner confirms them.
 */
import { Injectable } from "@nestjs/common";
import type { Scorecard, ScorecardQuery } from "@ecapital/shared";
import { and, asc, eq, gte, lt, or, sql } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import type { I18nService } from "../common/i18n.service";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { type ScoreExportOrder, scorecardWorkbook } from "./maintenance-export";
import { iso, num } from "./maintenance-rows";
import { type ScoreInput, type ScoreOrder, computeScorecard } from "./scorecard";

@Injectable()
export class ScorecardService {
  async scorecard(query: ScorecardQuery): Promise<Scorecard> {
    const { input } = await this.load(query);
    return computeScorecard(input);
  }

  async workbook(query: ScorecardQuery, i18n: I18nService): Promise<{ ref: string; file: Buffer }> {
    const { input, exportRows } = await this.load(query);
    const file = await scorecardWorkbook(input, exportRows, i18n);
    return { ref: input.contract.ref, file };
  }

  private async load(
    query: ScorecardQuery,
  ): Promise<{ input: ScoreInput; exportRows: ScoreExportOrder[] }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(query.maintenanceContractId)) {
      throw AppError.notFound("errors.maintenanceContractNotFound");
    }
    const [contract] = await tx.db
      .select({ contract: schema.maintenanceContract, contractorName: schema.contractor.name })
      .from(schema.maintenanceContract)
      .innerJoin(schema.contractor, eq(schema.contractor.id, schema.maintenanceContract.contractorId))
      .where(eq(schema.maintenanceContract.id, query.maintenanceContractId))
      .limit(1);
    if (!contract) throw AppError.notFound("errors.maintenanceContractNotFound");

    const from = new Date(`${query.from}T00:00:00Z`);
    const to = new Date(`${query.to}T00:00:00Z`);
    const w = schema.workOrder;
    const rows = await tx.db
      .select({
        order: w,
        slaSystemCode: schema.slaSystem.code,
        slaSystemName: schema.slaSystem.nameEl,
        assetTag: schema.asset.tag,
        penaltyPmPerDay: schema.slaSystem.penaltyPmPerDay,
        penaltyResponsePerHour: schema.slaSystem.penaltyResponsePerHour,
        penaltyRestorePerHour: schema.slaSystem.penaltyRestorePerHour,
      })
      .from(w)
      .leftJoin(schema.slaSystem, eq(schema.slaSystem.id, w.slaSystemId))
      .leftJoin(schema.asset, eq(schema.asset.id, w.assetId))
      .where(
        and(
          eq(w.maintenanceContractId, query.maintenanceContractId),
          or(
            and(gte(w.calledAt, from), lt(w.calledAt, to)),
            and(
              eq(w.kind, "PM"),
              sql`${w.dueDate} >= ${query.from}::date and ${w.dueDate} < ${query.to}::date`,
            ),
          ),
        ),
      )
      .orderBy(asc(w.calledAt), asc(w.ref));

    const orders: ScoreOrder[] = rows.map((row) => ({
      id: row.order.id,
      ref: row.order.ref,
      kind: row.order.kind,
      status: row.order.status,
      band: row.order.band,
      slaSystemCode: row.slaSystemCode,
      slaSystemName: row.slaSystemName,
      assetId: row.order.assetId,
      calledAt: row.order.calledAt.toISOString(),
      dueResponseAt: iso(row.order.dueResponseAt),
      respondedAt: iso(row.order.respondedAt),
      dueRestoreAt: iso(row.order.dueRestoreAt),
      restoredAt: iso(row.order.restoredAt),
      completedAt: iso(row.order.completedAt),
      dueReportAt: iso(row.order.dueReportAt),
      reportReceivedAt: iso(row.order.reportReceivedAt),
      dueDate: row.order.dueDate,
      penaltyPmPerDay: num(row.penaltyPmPerDay),
      penaltyResponsePerHour: num(row.penaltyResponsePerHour),
      penaltyRestorePerHour: num(row.penaltyRestorePerHour),
    }));

    const c = contract.contract;
    const input: ScoreInput = {
      contract: {
        id: c.id,
        ref: c.ref,
        contractorName: contract.contractorName,
        availabilityHoursYear: c.availabilityHoursYear,
        availabilityPenaltyCriticalPerHour: Number(c.availabilityPenaltyCriticalPerHour),
        availabilityPenaltyOtherPerHour: Number(c.availabilityPenaltyOtherPerHour),
        contractValue: num(c.contractValue),
      },
      from: query.from,
      to: query.to,
      now: new Date().toISOString(),
      orders,
    };

    const exportRows: ScoreExportOrder[] = rows.map((row, index) => ({
      ref: row.order.ref,
      kind: row.order.kind,
      status: row.order.status,
      band: row.order.band,
      system: row.slaSystemCode ? `${row.slaSystemCode} — ${row.slaSystemName ?? ""}` : "",
      assetTag: row.assetTag,
      calledAt: orders[index].calledAt,
      dueResponseAt: orders[index].dueResponseAt,
      respondedAt: orders[index].respondedAt,
      dueRestoreAt: orders[index].dueRestoreAt,
      restoreMetAt: orders[index].restoredAt ?? orders[index].completedAt,
      dueReportAt: orders[index].dueReportAt,
      reportReceivedAt: orders[index].reportReceivedAt,
      completedAt: orders[index].completedAt,
      dueDate: row.order.dueDate,
      penaltyResponsePerHour: orders[index].penaltyResponsePerHour,
      penaltyRestorePerHour: orders[index].penaltyRestorePerHour,
      penaltyPmPerDay: orders[index].penaltyPmPerDay,
    }));

    return { input, exportRows };
  }
}
