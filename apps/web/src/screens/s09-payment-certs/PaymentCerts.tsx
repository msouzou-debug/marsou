"use client";

// S09 — R11
//
/**
 * PaymentCerts — the pure S09 list screen: the contract tab strip, and the
 * dense table of payment certificates (number, period, work done, materials,
 * retention held, previous certified, net payable, status chip, SAP invoice
 * ref). «Νέο πιστοποιητικό» is `canCreatePaymentCert` (project_engineer/
 * estates_head/admin), the same set that runs the rest of the contract.
 *
 * RULE (build brief §5 S09): retention is its own column here too — never
 * folded into net payable, the same rule `CertificateDetail` keeps.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AppRole, PaymentCert } from "@ecapital/shared";
import { canCreatePaymentCert } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatEUR } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";

export type PaymentCertsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface PaymentCertsProps {
  data?: PaymentCert[];
  contractId: string;
  contractNo?: string;
  state: PaymentCertsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  onAdd: () => void;
  onRowOpen: (cert: PaymentCert) => void;
  rfisOpenCount?: number;
  defectsOpenCount?: number;
}

export function PaymentCerts({
  data,
  contractId,
  contractNo,
  state,
  onRetry,
  noPermission,
  roles = [],
  onAdd,
  onRowOpen,
  rfisOpenCount,
  defectsOpenCount,
}: PaymentCertsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const canAdd = canCreatePaymentCert(roles);

  const columns: TableColumn<PaymentCert>[] = [
    { id: "number", headerKey: "screens.s09.columns.number", accessor: (row) => row.number, numeric: true },
    { id: "period", headerKey: "screens.s09.columns.period", accessor: (row) => row.periodFrom, cell: (row) => `${row.periodFrom} — ${row.periodTo}` },
    { id: "workDone", headerKey: "screens.s09.columns.workDone", accessor: (row) => row.workDoneValue, numeric: true, cell: (row) => formatEUR(row.workDoneValue) },
    { id: "materials", headerKey: "screens.s09.columns.materials", accessor: (row) => row.materialsOnSite, numeric: true, cell: (row) => formatEUR(row.materialsOnSite) },
    { id: "retentionHeld", headerKey: "screens.s09.columns.retentionHeld", accessor: (row) => row.retentionHeld, numeric: true, cell: (row) => formatEUR(row.retentionHeld) },
    { id: "previousCertified", headerKey: "screens.s09.columns.previousCertified", accessor: (row) => row.previousCertified, numeric: true, cell: (row) => formatEUR(row.previousCertified) },
    { id: "netPayable", headerKey: "screens.s09.columns.netPayable", accessor: (row) => row.netPayable, numeric: true, cell: (row) => formatEUR(row.netPayable) },
    { id: "status", headerKey: "screens.s09.columns.status", accessor: (row) => row.status, cell: (row) => t(`screens.s09.status.${row.status}`) },
    { id: "sapInvoiceRef", headerKey: "screens.s09.columns.sapInvoiceRef", accessor: (row) => row.sapInvoiceRef ?? "", cell: (row) => row.sapInvoiceRef ?? t("common.notAvailable") },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";

  return (
    <>
      <PageTitle
        eyebrow={contractNo ?? ""}
        title={t("screens.s09.title")}
        tabs={<ContractTabs contractId={contractId} active="certificates" rfisOpenCount={rfisOpenCount} defectsOpenCount={defectsOpenCount} />}
        action={
          canAdd && state !== "offline" ? (
            // A link, like S02's «Προσθήκη»: it goes somewhere, so it is
            // navigation, not an action. `onAdd` stays for the empty state.
            <Link
              href={`/contracts/${encodeURIComponent(contractId)}/certificates/new`}
              className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k"
            >
              {t("buttons.add")}
            </Link>
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <Table<PaymentCert>
        tableId="s09-payment-certs"
        columns={columns}
        rows={data ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s09.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={onRowOpen}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s09.empty", actionLabelKey: "buttons.add", onAction: canAdd ? onAdd : undefined }}
      />
    </>
  );
}
