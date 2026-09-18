import { Injectable } from "@nestjs/common";
import { OrgUnit } from "@ecapital/shared";
import { asc } from "drizzle-orm";
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
        timezone: schema.orgUnit.timezone,
      })
      .from(schema.orgUnit)
      .orderBy(asc(schema.orgUnit.nameEl));

    // Same shape the frontend mock served (ADR-0005): the app swaps base URL
    // and sees no difference.
    return OrgUnit.array().parse(rows);
  }
}
