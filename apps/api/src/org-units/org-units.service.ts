import { Injectable } from "@nestjs/common";
import { OrgUnit } from "@ecapital/shared";
import { asc, eq } from "drizzle-orm";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { AppError } from "../common/errors";

@Injectable()
export class OrgUnitsService {
  /**
   * The units this caller may see. There is no `where` clause on org unit
   * here on purpose: the row-level-security policy is what filters, so a
   * caller cannot be given more by a bug in this method (ADR-0010).
   */
  async listVisible(): Promise<OrgUnit[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({
        id: schema.orgUnit.id,
        code: schema.orgUnit.code,
        nameEl: schema.orgUnit.nameEl,
        nameEn: schema.orgUnit.nameEn,
        type: schema.orgUnit.type,
        directorate: schema.orgUnit.directorate,
        costCentre: schema.orgUnit.costCentre,
        // ADR-0019: the eFinance entity code, null where there is none.
        entityCode: schema.orgUnit.entityCode,
        // ADR-0022's addendum (20/09/2026): eFinance's own key, kept
        // alongside entityCode rather than translated into it.
        efinanceCode: schema.orgUnit.efinanceCode,
        timezone: schema.orgUnit.timezone,
      })
      .from(schema.orgUnit)
      .orderBy(asc(schema.orgUnit.nameEl));

    // Same shape the frontend mock served (ADR-0005): the app swaps base URL
    // and sees no difference.
    return OrgUnit.array().parse(rows);
  }

  /**
   * ADR-0022's addendum (owner decision, 20/09/2026): eFinance keeps its own
   * entity keys, so anything that calls eFinance on a unit's behalf — the
   * future SAP actuals / spent-ledger reader, docs/INTEGRATION-eFinance-
   * eMAP-eCapital.md §5 — has to send eFinance's code, not ours. This is the
   * one place that translates; nothing else in the codebase should read
   * `efinance_code` directly. Null where eFinance has no entity for this
   * unit, the same as a unit id that does not exist — the caller decides
   * what a missing code means for its own request, this method only answers
   * what the column holds.
   */
  async efinanceCodeFor(orgUnitId: string): Promise<string | null> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const [row] = await tx.db
      .select({ efinanceCode: schema.orgUnit.efinanceCode })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, orgUnitId));

    return row?.efinanceCode ?? null;
  }
}
