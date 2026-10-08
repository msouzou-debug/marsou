import type { PaymentCertStatus } from "@ecapital/shared";
import type { Need } from "./needs.guard";

/**
 * ADR-0033. The row of the role matrix each step of a payment certificate
 * needs (R11). The engineer's sign-off is what was built; from FINANCE_RECEIVED
 * on it is money leaving the organisation. The service and the inbox ask the
 * same table, so a certificate never shows up as waiting on somebody the
 * transition would refuse.
 */
export const CERT_STEP_NEEDS: Record<PaymentCertStatus, Need | null> = {
  DRAFT: null,
  ENGINEER_APPROVED: ["paymentCertEngineer", "APPROVE"],
  FINANCE_RECEIVED: ["paymentCertFinance", "APPROVE"],
  PAID: ["paymentCertFinance", "APPROVE"],
};
