"use client";

// S06 — R07 (Risk and issue registers per project)
//
/**
 * RisksIssues — the pure S06 screen body: the shared project tab strip, the
 * risk matrix and register, and the issue register — each register a dense
 * `Table` on desktop and cards on phone (`RiskCards`/`IssueCards`), the same
 * split S02's own table/cards pair uses.
 *
 * | Prop            | Type                     | Notes                                                        |
 * |-----------------|--------------------------|-------------------------------------------------------------------|
 * | data            | ProjectDetail?           | Ignored in `noPermission` \| `loading` \| `error`; required otherwise. |
 * | state           | RisksIssuesScreenState   | The network state; each register's own `empty` is computed locally from `data`. |
 * | onRetry         | () => void?              |                                                                     |
 * | noPermission    | ReactNode                |                                                                     |
 * | roles           | AppRole[]                | `canWriteProjects(roles)` gates «Προσθήκη» and the sheets — same check S03 uses for «Επεξεργασία». |
 * | today           | Date?                    | Injectable "now" for the overdue-issue rule.                        |
 * | selectedRiskId / selectedIssueId | string \| "new" \| null | Which sheet is open, if any — at most one at a time. |
 * | onSelectRisk / onSelectIssue     | (id) => void            |                                                       |
 * | sheetSaving / sheetApiError      | —                       | Shared by whichever sheet is open (only one is, ever).|
 * | onSaveRisk / onSaveIssue         | (values) => void        |                                                       |
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import type { AppRole, Issue, ProjectDetail, Risk } from "@ecapital/shared";
import { canWriteProjects } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn, type TableState } from "@/components/table";
import { formatDate } from "@/lib/format";
import { ProjectTabs } from "@/screens/s03-project/ProjectTabs";
import { IssueCards } from "./IssueCards";
import { IssueSheet } from "./IssueSheet";
import type { IssueFormValues, RiskFormValues } from "./schema";
import { isIssueOverdue } from "./issue-status";
import { RiskCards } from "./RiskCards";
import { riskScore } from "./risk-matrix";
import { RiskMatrix } from "./RiskMatrix";
import { RiskSheet } from "./RiskSheet";

export type RisksIssuesScreenState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface RisksIssuesProps {
  data?: ProjectDetail;
  state: RisksIssuesScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  today?: Date;
  selectedRiskId?: string | "new" | null;
  selectedIssueId?: string | "new" | null;
  onSelectRisk?: (id: string | "new" | null) => void;
  onSelectIssue?: (id: string | "new" | null) => void;
  sheetSaving?: boolean;
  sheetApiError?: string;
  onSaveRisk?: (values: RiskFormValues) => void;
  onSaveIssue?: (values: IssueFormValues) => void;
}

export function RisksIssues({
  data,
  state,
  onRetry,
  noPermission,
  roles = [],
  today = new Date(),
  selectedRiskId,
  selectedIssueId,
  onSelectRisk = () => undefined,
  onSelectIssue = () => undefined,
  sheetSaving = false,
  sheetApiError,
  onSaveRisk = () => undefined,
  onSaveIssue = () => undefined,
}: RisksIssuesProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  if (state === "loading" || state === "error" || !data) {
    return (
      <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
        {state === "loading" ? (
          <div aria-hidden="true" aria-busy="true" className="grid animate-pulse gap-s-2 text-left">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-9 w-full rounded-k bg-k-grey" />
            ))}
          </div>
        ) : (
          <>
            <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
                {t("common.retry")}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const canEdit = canWriteProjects(roles);
  const offline = state === "offline";

  const riskColumns: TableColumn<Risk>[] = [
    { id: "description", headerKey: "screens.s06.riskColumns.description", accessor: (row) => row.descriptionEl },
    { id: "likelihood", headerKey: "screens.s06.riskColumns.likelihood", accessor: (row) => row.likelihood, numeric: true },
    { id: "impact", headerKey: "screens.s06.riskColumns.impact", accessor: (row) => row.impact, numeric: true },
    { id: "score", headerKey: "screens.s06.riskColumns.score", accessor: (row) => riskScore(row), numeric: true },
    { id: "owner", headerKey: "screens.s06.riskColumns.owner", accessor: (row) => row.ownerName ?? t("common.notAvailable") },
    {
      id: "mitigation",
      headerKey: "screens.s06.riskColumns.mitigation",
      accessor: (row) => row.mitigationEl ?? "",
      // RULE (build brief, an explicit exception to CONVENTIONS.md's
      // no-ellipsis rule): Μέτρα is free text and can run long, so it is
      // truncated to one line here — the full text is always on the row's
      // `title` and in full in the sheet the row opens.
      cell: (row) =>
        row.mitigationEl ? (
          <span className="block max-w-[220px] truncate" title={row.mitigationEl}>
            {row.mitigationEl}
          </span>
        ) : (
          t("common.notAvailable")
        ),
    },
    {
      id: "status",
      headerKey: "screens.s06.riskColumns.status",
      accessor: (row) => row.status,
      cell: (row) => t(`riskStatus.${row.status}`),
    },
  ];

  const issueColumns: TableColumn<Issue>[] = [
    { id: "description", headerKey: "screens.s06.issueColumns.description", accessor: (row) => row.descriptionEl },
    { id: "raisedBy", headerKey: "screens.s06.issueColumns.raisedBy", accessor: (row) => row.raisedByName },
    {
      id: "dueDate",
      headerKey: "screens.s06.issueColumns.dueDate",
      accessor: (row) => row.dueDate ?? "",
      numeric: true,
      cell: (row) => {
        const overdue = isIssueOverdue(row, today);
        return (
          <span className={`inline-flex items-center gap-s-1 ${overdue ? "text-k-red" : "text-k-ink"}`}>
            {overdue && <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />}
            {row.dueDate ? formatDate(row.dueDate) : t("common.notAvailable")}
          </span>
        );
      },
    },
    {
      id: "status",
      headerKey: "screens.s06.issueColumns.status",
      accessor: (row) => row.status,
      cell: (row) => t(`issueStatus.${row.status}`),
    },
  ];

  const risksTableState: TableState = offline ? "offline" : data.risks.length === 0 ? "empty" : "default";
  const issuesTableState: TableState = offline ? "offline" : data.issues.length === 0 ? "empty" : "default";

  const selectedRisk = selectedRiskId && selectedRiskId !== "new" ? data.risks.find((r) => r.id === selectedRiskId) : undefined;
  const selectedIssue = selectedIssueId && selectedIssueId !== "new" ? data.issues.find((i) => i.id === selectedIssueId) : undefined;

  // Nit 4 (one filled-blue primary per view): the two section «Προσθήκη»
  // buttons are secondary/outline — the same style S07's «Επεξεργασία» link
  // uses — so they never compete with a table's own empty-state action,
  // which stays the page's one primary button when it is the only one showing.
  function addButton(onClick: () => void) {
    return offline ? (
      <span title={t("states.offline.readOnly")} aria-disabled="true" className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 font-bold text-k-text opacity-50">
        {t("buttons.add")}
      </span>
    ) : (
      <button type="button" onClick={onClick} className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep">
        {t("buttons.add")}
      </button>
    );
  }

  return (
    <>
      <PageTitle eyebrow={data.code} title={t("screens.s06.title")} tabs={<ProjectTabs projectId={data.id} active="risksIssues" />} />

      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <section className="mt-s-2">
        <div className="mb-s-3 flex items-center justify-between gap-s-3">
          <h2 className="text-fs-20">{t("screens.s06.risksTitle")}</h2>
          {canEdit && addButton(() => onSelectRisk("new"))}
        </div>

        <RiskMatrix risks={data.risks} />

        <div className="mt-s-4 hidden tablet:block">
          <Table<Risk>
            tableId="s06-risks"
            columns={riskColumns}
            rows={data.risks}
            getRowId={(row) => row.id}
            captionKey="screens.s06.risksCaption"
            state={risksTableState}
            onExport={() => undefined}
            onRetry={onRetry}
            onRowOpen={(row) => onSelectRisk(row.id)}
            emptyState={{ messageKey: "screens.s06.risksEmpty", actionLabelKey: "buttons.add", onAction: canEdit ? () => onSelectRisk("new") : undefined }}
          />
        </div>
        <div className="mt-s-4 tablet:hidden">
          {data.risks.length === 0 ? (
            <p className="text-fs-16 text-k-text">{t("screens.s06.risksEmpty")}</p>
          ) : (
            <RiskCards risks={data.risks} onOpen={(row) => onSelectRisk(row.id)} />
          )}
        </div>
      </section>

      <section className="mt-s-8">
        <div className="mb-s-3 flex items-center justify-between gap-s-3">
          <h2 className="text-fs-20">{t("screens.s06.issuesTitle")}</h2>
          {canEdit && addButton(() => onSelectIssue("new"))}
        </div>

        <div className="hidden tablet:block">
          <Table<Issue>
            tableId="s06-issues"
            columns={issueColumns}
            rows={data.issues}
            getRowId={(row) => row.id}
            captionKey="screens.s06.issuesCaption"
            state={issuesTableState}
            onExport={() => undefined}
            onRetry={onRetry}
            onRowOpen={(row) => onSelectIssue(row.id)}
            emptyState={{ messageKey: "screens.s06.issuesEmpty", actionLabelKey: "buttons.add", onAction: canEdit ? () => onSelectIssue("new") : undefined }}
          />
        </div>
        <div className="tablet:hidden">
          {data.issues.length === 0 ? (
            <p className="text-fs-16 text-k-text">{t("screens.s06.issuesEmpty")}</p>
          ) : (
            <IssueCards issues={data.issues} onOpen={(row) => onSelectIssue(row.id)} today={today} />
          )}
        </div>
      </section>

      {canEdit && selectedRiskId && (
        <RiskSheet open risk={selectedRisk} saving={sheetSaving} apiError={sheetApiError} onClose={() => onSelectRisk(null)} onSave={onSaveRisk} />
      )}
      {canEdit && selectedIssueId && (
        <IssueSheet open issue={selectedIssue} saving={sheetSaving} apiError={sheetApiError} onClose={() => onSelectIssue(null)} onSave={onSaveIssue} />
      )}
    </>
  );
}
