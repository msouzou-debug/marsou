/**
 * R18 — the year-end accrual proposal.
 *
 * CAPEX-01 §7: "Year-end: accrual proposal listing work certified but not
 * invoiced, per project and cost centre, exportable to Excel with live
 * formulas."
 *
 * Certified but not invoiced is a certificate that has been approved by the
 * engineer or received by finance, and has not been paid. What has been
 * invoiced against the contract in the year is what SAP has posted as an
 * actual on it. The difference is the accrual, and it is the figure the
 * organisation owes for work already done when the books close.
 *
 * ADR-0010: no permission check. The row policies decide which certificates
 * a caller can see, so a finance user sees the whole organisation and a head
 * of estates sees their own unit — from the same query.
 */
import { Injectable } from "@nestjs/common";
import { type AccrualRow, DEFAULT_VAT_RATE, type VatRate } from "@ecapital/shared";
import { sql } from "drizzle-orm";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import { accrualOf, money } from "./cost-rows";
import type { AccrualQuery } from "./cost-contracts";

@Injectable()
export class CostAccrualsService {
  async list(query: AccrualQuery): Promise<AccrualRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const asOf = `${query.year}-12-31`;

    const result = await tx.db.execute<{
      project_id: string;
      project_code: string;
      project_title_el: string;
      contract_id: string;
      contract_ref: string;
      contractor_name: string;
      cost_centre: string | null;
      cert_number: number;
      certified_net: string;
      vat_rate: VatRate | null;
      certified_vat: string;
      certified_gross: string;
      invoiced: string;
    }>(sql`
      select p.id as project_id,
             p.code as project_code,
             p.title_el as project_title_el,
             c.id as contract_id,
             c.ref as contract_ref,
             v.name as contractor_name,
             coalesce(p.cost_centre, o.cost_centre) as cost_centre,
             pc.number as cert_number,
             pc.net_payable::text as certified_net,
             pc.vat_rate,
             pc.vat_amount::text as certified_vat,
             pc.gross_payable::text as certified_gross,
             coalesce((
               select sum(t.amount) from ecapital.cost_txn t
                where t.contract_id = c.id
                  and t.txn_type = 'ACTUAL'
                  and ecapital.cost_txn_counts_as_spent(t.source, t.contract_id)
                  and t.posting_date between ${`${query.year}-01-01`}::date and ${asOf}::date
             ), 0)::text as invoiced
        from ecapital.payment_cert pc
        join ecapital.contract c on c.id = pc.contract_id
        join ecapital.project p on p.id = c.project_id
        join ecapital.contractor v on v.id = c.contractor_id
        join ecapital.org_unit o on o.id = p.org_unit_id
       where pc.status in ('ENGINEER_APPROVED', 'FINANCE_RECEIVED')
         and pc.period_to <= ${asOf}::date
         and (${query.orgUnitId ?? null}::text is null or p.org_unit_id = ${query.orgUnitId ?? null}::text)
       order by p.code, c.ref, pc.number`);

    return result.rows.map((row) => {
      const certifiedNet = money(row.certified_net);
      const certifiedVat = money(row.certified_vat);
      const certifiedGross = money(row.certified_gross);
      const invoiced = money(row.invoiced);
      // ADR-0038: gross against gross — what finance pays on the certificate
      // against what was posted, which is posted gross.
      const { accrual, overInvoiced } = accrualOf(certifiedGross, invoiced);
      return {
        projectId: row.project_id,
        projectCode: row.project_code,
        projectTitleEl: row.project_title_el,
        contractId: row.contract_id,
        contractRef: row.contract_ref,
        contractorName: row.contractor_name,
        costCentre: row.cost_centre,
        certNumber: row.cert_number,
        certifiedNet,
        vatRate: row.vat_rate ?? DEFAULT_VAT_RATE,
        certifiedVat,
        certifiedGross,
        invoiced,
        accrual,
        overInvoiced,
        asOf,
      };
    });
  }
}
