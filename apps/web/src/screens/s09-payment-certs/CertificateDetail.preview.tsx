// S09 — R11

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { CertificateDetail } from "./CertificateDetail";
import { buildPaymentCert } from "./fixture";

const noPermission = <NoPermission />;
const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s09-certificate-detail",
  title: "S09 Πιστοποιητικό (λεπτομέρεια)",
  states: {
    default: () => (
      <CertificateDetail
        cert={buildPaymentCert({ status: "FINANCE_RECEIVED", approvedByName: "Μαρία Κωνσταντίνου", approvedAt: "2026-07-02T09:00:00.000Z", sapInvoiceRef: "INV-2244" })}
        contractNo="ΤΥ/2026/012"
        state="default"
        noPermission={noPermission}
        roles={["finance"]}
        dlpEnded={false}
        onTransition={noop}
      />
    ),
    loading: () => <CertificateDetail state="loading" noPermission={noPermission} onTransition={noop} />,
    error: () => <CertificateDetail state="error" noPermission={noPermission} onTransition={noop} onRetry={noop} />,
    noPermission: () => <CertificateDetail state="noPermission" noPermission={noPermission} onTransition={noop} />,
    offline: () => (
      <CertificateDetail cert={buildPaymentCert({ status: "PAID", paidDate: "2026-07-01" })} state="offline" noPermission={noPermission} roles={["finance"]} onTransition={noop} />
    ),
  },
  notes:
    "default is FINANCE_RECEIVED for a finance caller: the «Εξόφληση» panel, its retention-release checkbox " +
    "and the DLP-not-ended warning (dlpEnded=false) all show — the warning never disables the button, only " +
    "the missing paid date does. empty is skipped: a certificate detail page names one certificate or none, " +
    "the same reasoning ContractOverview's own header comment gives.",
};

export default entry;
