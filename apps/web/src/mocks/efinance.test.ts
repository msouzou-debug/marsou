import { describe, expect, it } from "vitest";
import {
  BudgetPosition,
  ContractBudgetPosition,
  EFinanceContractStatus,
  EFinanceContractSummary,
  EFinanceInvoiceList,
  EFinanceMasterSyncResult,
  EFinanceRequisitionList,
  EFinanceSyncResult,
  EFinanceVendorList,
  ProjectBudgetPosition,
} from "@ecapital/shared";
import {
  buildBudgetPosition,
  buildContractBudgetPosition,
  buildEFinanceInvoiceList,
  buildEFinanceMasterSyncResult,
  buildEFinanceRequisitionList,
  buildEFinanceStatus,
  buildEFinanceSummary,
  buildEFinanceSyncResult,
  buildEFinanceVendorList,
  buildProjectBudgetPosition,
} from "./efinance";

// The fixtures stand in for the API in tests and the gallery, so they must be
// exactly what the API's schemas accept — otherwise a screen is tested on a
// shape it will never receive.
describe("eFinance fixtures parse with the shared schemas", () => {
  it.each([
    ["summary", EFinanceContractSummary, buildEFinanceSummary()],
    ["status", EFinanceContractStatus, buildEFinanceStatus()],
    ["invoices", EFinanceInvoiceList, buildEFinanceInvoiceList()],
    ["requisitions", EFinanceRequisitionList, buildEFinanceRequisitionList()],
    ["position", BudgetPosition, buildBudgetPosition()],
    ["contract position", ContractBudgetPosition, buildContractBudgetPosition()],
    ["project position", ProjectBudgetPosition, buildProjectBudgetPosition()],
    ["vendors", EFinanceVendorList, buildEFinanceVendorList()],
    ["sync", EFinanceSyncResult, buildEFinanceSyncResult()],
    ["master sync", EFinanceMasterSyncResult, buildEFinanceMasterSyncResult()],
  ] as const)("%s", (_name, schema, value) => {
    expect(() => schema.parse(value)).not.toThrow();
  });

  it("covers every invoice ledger", () => {
    expect(buildEFinanceInvoiceList().items.map((i) => i.ledger).sort()).toEqual(["booked", "in_flight", "rejected", "reversed"]);
  });
});
