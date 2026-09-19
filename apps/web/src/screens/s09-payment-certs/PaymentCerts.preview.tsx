// S09 — R11

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { PaymentCerts } from "./PaymentCerts";
import { buildPaymentCert } from "./fixture";

const noPermission = <NoPermission />;
const noop = () => undefined;

const certs = [
  buildPaymentCert({ id: "c1", number: 1, status: "PAID", paidDate: "2026-04-01", sapInvoiceRef: "INV-2201" }),
  buildPaymentCert({ id: "c2", number: 2, status: "FINANCE_RECEIVED", sapInvoiceRef: "INV-2244" }),
  buildPaymentCert({ id: "c3", number: 3, status: "ENGINEER_APPROVED" }),
  buildPaymentCert({ id: "c4", number: 4, status: "DRAFT" }),
];

const entry: PreviewEntry = {
  id: "s09-payment-certs",
  title: "S09 Πιστοποιητικά πληρωμής",
  states: {
    default: () => (
      <PaymentCerts data={certs} contractId="contract-1" contractNo="ΤΥ/2026/012" state="default" noPermission={noPermission} roles={["project_engineer"]} onAdd={noop} onRowOpen={noop} />
    ),
    loading: () => <PaymentCerts contractId="contract-1" state="loading" noPermission={noPermission} onAdd={noop} onRowOpen={noop} />,
    empty: () => (
      <PaymentCerts data={[]} contractId="contract-1" state="empty" noPermission={noPermission} roles={["project_engineer"]} onAdd={noop} onRowOpen={noop} />
    ),
    error: () => <PaymentCerts contractId="contract-1" state="error" noPermission={noPermission} onAdd={noop} onRowOpen={noop} onRetry={noop} />,
    noPermission: () => <PaymentCerts contractId="contract-1" state="noPermission" noPermission={noPermission} onAdd={noop} onRowOpen={noop} />,
  },
  notes: "Retention held and net payable stay separate columns throughout — see the build brief's own rule.",
};

export default entry;
