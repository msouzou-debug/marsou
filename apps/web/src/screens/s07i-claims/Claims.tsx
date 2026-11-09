"use client";

// S07i — ADR-0035
//
/**
 * Claims — the pure «Αξιώσεις» body of a contract: every claim by the
 * contractor or by the Organisation, with its stage, and the open totals
 * by direction. WRITE roles add and edit; everyone else reads.
 *
 * | Prop    | Type                    | Notes                                                    |
 * |---------|-------------------------|----------------------------------------------------------|
 * | data    | ContractDetail?         | Carries `claims`.                                         |
 * | state   | ClaimsScreenState       |                                                          |
 * | roles   | AppRole[]               | `canWriteContracts` gates the add and edit controls.      |
 * | onSave  | (id \| null, values) => Promise<boolean> | Wired by `ClaimsScreen`; true closes the panel. |
 *
 * RULE (ADR-0035 §4): open stages are the shared `CLAIM_OPEN_STAGES`; the
 * totals sum only those.
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CLAIM_OPEN_STAGES, type AppRole, type ContractClaim, type ContractDetail } from "@ecapital/shared";
import { canWriteContracts } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDate, formatEUR } from "@/lib/format";
import { ContractTabs } from "@/screens/s07-contract/ContractTabs";
import { ClaimForm } from "./ClaimForm";
import type { ClaimFormValues } from "./schema";

export type ClaimsScreenState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface ClaimsProps {
  data?: ContractDetail;
  state: ClaimsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  saving?: boolean;
  apiError?: string;
  onSave?: (claimId: string | null, values: ClaimFormValues) => Promise<boolean>;
  onClearError?: () => void;
}

const STAGE_CHIP: Record<ContractClaim["stage"], string> = {
  NOTIFIED: "bg-k-amber-bg text-k-ink",
  UNDER_REVIEW: "bg-k-amber-bg text-k-ink",
  NEGOTIATION: "bg-k-amber-bg text-k-ink",
  ARBITRATION: "bg-k-red-bg text-k-ink",
  COURT: "bg-k-red-bg text-k-ink",
  SETTLED: "bg-k-green-bg text-k-ink",
  WITHDRAWN: "bg-k-grey text-k-ink",
};

export function Claims({
  data,
  state,
  onRetry,
  noPermission,
  roles = [],
  saving = false,
  apiError,
  onSave = async () => false,
  onClearError,
}: ClaimsProps) {
  const t = useTranslations();
  const [panel, setPanel] = useState<{ id: string | null } | null>(null);

  if (state === "noPermission") return <>{noPermission}</>;

  const offline = state === "offline";
  const canWrite = canWriteContracts(roles) && !offline;
  const claims = [...(data?.claims ?? [])].sort((a, b) => (b.notifiedAt ?? "").localeCompare(a.notifiedAt ?? ""));
  const open = claims.filter((c) => CLAIM_OPEN_STAGES.includes(c.stage));
  const sumOf = (direction: ContractClaim["direction"]) =>
    open.filter((c) => c.direction === direction).reduce((sum, c) => sum + c.amount, 0);
  const tableState =
    state === "loading" ? "loading" : state === "error" ? "error" : claims.length === 0 ? "empty" : offline ? "offline" : "default";

  function openPanel(id: string | null) {
    onClearError?.();
    setPanel({ id });
  }

  const editing = panel?.id ? claims.find((c) => c.id === panel.id) : undefined;

  const columns: TableColumn<ContractClaim>[] = [
    {
      id: "direction",
      headerKey: "screens.s07i.columns.direction",
      accessor: (c) => c.direction,
      sortable: false,
      cell: (c) => t(`claimDirection.${c.direction}`),
    },
    { id: "title", headerKey: "screens.s07i.columns.title", accessor: (c) => c.titleEl, sortable: false },
    {
      id: "amount",
      headerKey: "screens.s07i.columns.amount",
      accessor: (c) => c.amount,
      numeric: true,
      sortable: false,
      cell: (c) => formatEUR(c.amount),
    },
    {
      id: "stage",
      headerKey: "screens.s07i.columns.stage",
      accessor: (c) => c.stage,
      sortable: false,
      cell: (c) => (
        <span className={`inline-flex items-center rounded-k-chip px-s-2 py-s-1 text-fs-12 ${STAGE_CHIP[c.stage]}`}>
          {t(`claimStage.${c.stage}`)}
        </span>
      ),
    },
    {
      id: "notifiedAt",
      headerKey: "screens.s07i.columns.notifiedAt",
      accessor: (c) => c.notifiedAt ?? "",
      numeric: true,
      sortable: false,
      cell: (c) => (c.notifiedAt ? formatDate(c.notifiedAt) : t("common.notAvailable")),
    },
    {
      id: "legalAdvisor",
      headerKey: "screens.s07i.columns.legalAdvisor",
      accessor: (c) => c.legalAdvisorEl ?? "",
      sortable: false,
      cell: (c) => c.legalAdvisorEl ?? t("common.notAvailable"),
    },
    {
      id: "contingent",
      headerKey: "screens.s07i.columns.contingent",
      accessor: (c) => (c.contingentLiability ? 1 : 0),
      sortable: false,
      cell: (c) => (c.contingentLiability ? t("common.yes") : t("common.no")),
    },
    { id: "notes", headerKey: "screens.s07i.columns.notes", accessor: (c) => c.notesEl, sortable: false },
    ...(canWrite
      ? [
          {
            id: "actions",
            headerKey: "screens.s07i.columns.actions",
            accessor: (c: ContractClaim) => c.id,
            sortable: false,
            cell: (c: ContractClaim) => (
              <button type="button" onClick={() => openPanel(c.id)} className="text-fs-14 text-k-blue-deep underline-offset-2 hover:underline">
                {t("buttons.edit")}
              </button>
            ),
          } satisfies TableColumn<ContractClaim>,
        ]
      : []),
  ];

  return (
    <>
      <PageTitle
        eyebrow={data?.contractNo ?? ""}
        title={t("screens.s07i.title")}
        tabs={
          data ? (
            <ContractTabs
              contractId={data.id}
              active="claims"
              rfisOpenCount={data.rfisOpen}
              defectsOpenCount={data.defects?.filter((d) => d.status !== "CLOSED").length}
            />
          ) : undefined
        }
        action={
          canWrite ? (
            <button type="button" onClick={() => openPanel(null)} className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k">
              {t("buttons.add")}
            </button>
          ) : undefined
        }
      />

      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {panel && (
        <ClaimForm
          claim={editing}
          saving={saving}
          apiError={apiError}
          onCancel={() => setPanel(null)}
          onSave={(values) => void onSave(panel.id, values).then((ok) => ok && setPanel(null))}
        />
      )}

      {data && claims.length > 0 && (
        <section aria-label={t("screens.s07i.openTitle")} className="mb-s-6">
          <h2 className="text-fs-16">{t("screens.s07i.openTitle")}</h2>
          <dl className="mt-s-2 grid max-w-[480px] gap-s-2 text-fs-14">
            <div className="flex items-baseline justify-between gap-s-3">
              <dt className="text-k-text">{t("screens.s07i.openByContractor")}</dt>
              <dd className="num text-k-ink" data-testid="open-by-contractor">{formatEUR(sumOf("BY_CONTRACTOR"))}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-s-3">
              <dt className="text-k-text">{t("screens.s07i.openByOrganisation")}</dt>
              <dd className="num text-k-ink" data-testid="open-by-organisation">{formatEUR(sumOf("BY_ORGANISATION"))}</dd>
            </div>
          </dl>
          <p className="mt-s-2 text-fs-12 text-k-text">{t("screens.s07i.openNote")}</p>
        </section>
      )}

      <Table<ContractClaim>
        tableId="s07i-claims"
        columns={columns}
        rows={claims}
        getRowId={(c) => c.id}
        captionKey="screens.s07i.caption"
        state={tableState}
        density="dense"
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s07i.empty", actionLabelKey: "buttons.add", onAction: canWrite ? () => openPanel(null) : undefined }}
      />
    </>
  );
}
