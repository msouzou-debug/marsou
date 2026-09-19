"use client";

// S05 — R06 (Milestones with baseline vs forecast vs actual)
//
/**
 * Schedule — the pure S05 screen body: the shared project tab strip, the
 * milestones table (baseline immutable, forecast/actual inline-editable on
 * double-click, `Enter` saves) and the horizontal timeline beneath it.
 *
 * | Prop         | Type                | Notes                                                        |
 * |--------------|---------------------|------------------------------------------------------------------|
 * | data         | ProjectDetail?      | Ignored in `noPermission` \| `loading` \| `error`; required otherwise. |
 * | state        | ScheduleScreenState |                                                                    |
 * | onRetry      | () => void?         | Wired to the error state's retry button.                          |
 * | noPermission | ReactNode           | The shell's `NoPermission`.                                         |
 * | roles        | AppRole[]           | `canWriteProjects(roles)` gates «Προσθήκη» and the inline editor — the same role check S03 uses for «Επεξεργασία» (`@/auth/roles`). |
 * | today        | Date?               | Injectable "now" for the deviation/status rules and the timeline.  |
 * | addOpen / onOpenAdd / onCloseAdd / onSubmitAdd / addSaving / addApiError | — | The «Προσθήκη» dialog, owned by `ScheduleScreen`. |
 * | onCellEdit   | (milestone, columnId, value) => void | Forwarded to `Table`'s own double-click editor. |
 * | cellApiError | string?             | The last inline-edit failure — e.g. `errors.baselineFixed`, if the API ever refuses one — shown as a banner above the table. |
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Flag, TriangleAlert } from "lucide-react";
import type { AppRole, Milestone, ProjectDetail } from "@ecapital/shared";
import { canWriteProjects } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { Table, type TableColumn, type TableState } from "@/components/table";
import { formatDate, formatDays } from "@/lib/format";
import { ProjectTabs } from "@/screens/s03-project/ProjectTabs";
import { MilestoneAddDialog } from "./MilestoneAddDialog";
import { MilestoneTimeline } from "./MilestoneTimeline";
import { deviationDays, milestoneStatus } from "./milestone-status";
import type { MilestoneFormValues } from "./schema";

export type ScheduleScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface ScheduleProps {
  data?: ProjectDetail;
  state: ScheduleScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  today?: Date;
  addOpen?: boolean;
  onOpenAdd?: () => void;
  onCloseAdd?: () => void;
  onSubmitAdd?: (values: MilestoneFormValues) => void;
  addSaving?: boolean;
  addApiError?: string;
  onCellEdit?: (milestone: Milestone, columnId: string, value: string) => void;
  cellApiError?: string;
}

export function Schedule({
  data,
  state,
  onRetry,
  noPermission,
  roles = [],
  today = new Date(),
  addOpen = false,
  onOpenAdd = () => undefined,
  onCloseAdd = () => undefined,
  onSubmitAdd = () => undefined,
  addSaving = false,
  addApiError,
  onCellEdit,
  cellApiError,
}: ScheduleProps) {
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
              <button
                type="button"
                onClick={onRetry}
                className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
              >
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
  const milestones = [...data.milestones].sort((a, b) => a.sortOrder - b.sortOrder);

  const columns: TableColumn<Milestone>[] = [
    { id: "title", headerKey: "screens.s05.columns.title", accessor: (row) => row.titleEl },
    {
      id: "gate",
      headerKey: "screens.s05.columns.gate",
      accessor: (row) => (row.isGate ? 1 : 0),
      cell: (row) =>
        row.isGate ? (
          <span className="inline-flex items-center gap-s-1 text-fs-14 text-k-blue-deep">
            <Flag size={16} strokeWidth={1.5} aria-hidden="true" />
            {/* RULE (build brief): the gate icon always carries this visible
                text too — the marker has to survive greyscale print. */}
            {t("screens.s03.gateLabel")}
          </span>
        ) : null,
    },
    {
      id: "baseline",
      headerKey: "screens.s05.columns.baseline",
      accessor: (row) => row.baselineDate,
      cell: (row) => formatDate(row.baselineDate),
      numeric: true,
      // RULE (ADR-0014): the baseline date is immutable once the milestone
      // exists. No `editable` here, so `Table`'s own double-click editor
      // (`Table.tsx`'s `startEdit`) never opens on this column — a changed
      // plan is a new milestone, not an edit to this one.
    },
    {
      id: "forecast",
      headerKey: "screens.s05.columns.forecast",
      accessor: (row) => row.forecastDate ?? "",
      cell: (row) => (row.forecastDate ? formatDate(row.forecastDate) : t("common.notAvailable")),
      numeric: true,
      editable: canEdit,
    },
    {
      id: "actual",
      headerKey: "screens.s05.columns.actual",
      accessor: (row) => row.actualDate ?? "",
      cell: (row) => (row.actualDate ? formatDate(row.actualDate) : t("common.notAvailable")),
      numeric: true,
      editable: canEdit,
    },
    {
      id: "deviation",
      headerKey: "screens.s05.columns.deviation",
      accessor: (row) => deviationDays(row) ?? 0,
      numeric: true,
      cell: (row) => {
        const deviation = deviationDays(row);
        if (deviation === null) return t("common.notAvailable");
        const late = deviation > 0;
        return (
          <span className={`inline-flex items-center gap-s-1 ${late ? "text-k-red" : "text-k-ink"}`}>
            {late && <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />}
            {formatDays(deviation, t("screens.s05.daysUnit"))}
          </span>
        );
      },
    },
    {
      id: "status",
      headerKey: "screens.s05.columns.status",
      accessor: (row) => milestoneStatus(row),
      cell: (row) => t(`screens.s05.status.${milestoneStatus(row)}`),
    },
  ];

  const tableState: TableState = offline ? "offline" : milestones.length === 0 ? "empty" : "default";

  return (
    <>
      <PageTitle
        eyebrow={data.code}
        title={t("screens.s03.tabs.schedule")}
        tabs={<ProjectTabs projectId={data.id} active="schedule" />}
        action={
          canEdit ? (
            offline ? (
              <span
                title={t("states.offline.readOnly")}
                aria-disabled="true"
                className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 font-bold text-k-text opacity-50"
              >
                {t("buttons.add")}
              </span>
            ) : (
              <button
                type="button"
                onClick={onOpenAdd}
                className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k"
              >
                {t("buttons.add")}
              </button>
            )
          ) : undefined
        }
      />

      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {cellApiError && (
        <p role="alert" className="mb-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {cellApiError}
        </p>
      )}

      <Table<Milestone>
        tableId="s05-milestones"
        columns={columns}
        rows={milestones}
        getRowId={(row) => row.id}
        captionKey="screens.s05.caption"
        state={tableState}
        onExport={() => undefined}
        onRetry={onRetry}
        onCellEdit={canEdit ? onCellEdit : undefined}
        emptyState={{
          messageKey: "screens.s05.empty",
          actionLabelKey: "buttons.add",
          onAction: canEdit ? onOpenAdd : undefined,
        }}
      />

      {tableState !== "empty" && <MilestoneTimeline milestones={milestones} today={today} />}

      {canEdit && (
        <MilestoneAddDialog open={addOpen} saving={addSaving} apiError={addApiError} onCancel={onCloseAdd} onSubmit={onSubmitAdd} />
      )}
    </>
  );
}
