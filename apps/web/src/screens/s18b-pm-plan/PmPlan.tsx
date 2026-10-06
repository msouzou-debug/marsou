"use client";

// S18b «Προληπτική συντήρηση» — R32 (ADR-0031 §1, §2)
//
/**
 * PmPlan — the pure S18b body, per unit: the agreement card, the SLA
 * catalogue with its Excel import, and the preventive programme with
 * «Έκδοση τώρα». The Screen owns the unit, the reads and the writes.
 *
 * | Prop           | Type                         | Notes                                                    |
 * |----------------|------------------------------|----------------------------------------------------------|
 * | orgUnits       | OrgUnit[]                    | The unit select.                                         |
 * | unitId         | string                       | "" until one is picked.                                  |
 * | state          | PmPlanState                  | The agreements read; the two tables carry their own.     |
 * | agreement      | MaintenanceContract \| null  | The unit's ACTIVE agreement, else its latest, else null. |
 * | canManage      | boolean                      | `canManageMaintenanceContract`.                          |
 * | …              |                              | See each section's own props table.                      |
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type {
  AssetListRow,
  Contractor,
  MaintenanceContract,
  MaintenanceContractWrite,
  OrgUnit,
  PmGenerationResult,
  PmSchedule,
  PmScheduleWrite,
  SlaImportResult,
  SlaSystem,
  SlaSystemWrite,
} from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import type { TableState } from "@/components/table";
import type { Locale } from "@/i18n/config";
import { AgreementCard } from "./AgreementCard";
import { CatalogueSection } from "./CatalogueSection";
import { SchedulesSection } from "./SchedulesSection";

export type PmPlanState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface PmPlanProps {
  orgUnits: OrgUnit[];
  unitId: string;
  onUnitChange: (id: string) => void;
  state: PmPlanState;
  onRetry?: () => void;
  noPermission: ReactNode;
  agreement: MaintenanceContract | null;
  contractors: Contractor[];
  systems?: SlaSystem[];
  systemsState: TableState;
  schedules?: PmSchedule[];
  schedulesState: TableState;
  assets: AssetListRow[];
  canManage: boolean;
  onSaveAgreement: (write: MaintenanceContractWrite, id?: string) => Promise<void>;
  onPatchSystem: (id: string, patch: Partial<SlaSystemWrite>) => Promise<void>;
  onImport: (file: File) => Promise<SlaImportResult>;
  onSaveSchedule: (write: PmScheduleWrite, id?: string) => Promise<void>;
  onGenerate: () => Promise<PmGenerationResult>;
}

export function PmPlan(props: PmPlanProps) {
  const { orgUnits, unitId, onUnitChange, state, onRetry, noPermission, agreement, contractors, canManage } = props;
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (state === "noPermission") return <>{noPermission}</>;
  const offline = state === "offline";

  return (
    <>
      <PageTitle
        eyebrow={
          <Link href="/maintenance" className="hover:underline">
            {t("nav.maintenance")}
          </Link>
        }
        title={t("screens.s18plan.title")}
      />
      <p className="mb-s-5 max-w-[720px] text-fs-16 text-k-text">{t("screens.s18plan.intro")}</p>

      <label className="mb-s-5 flex max-w-[420px] flex-col gap-s-1 text-fs-14 text-k-text">
        {t("common.unit")}
        <select value={unitId} onChange={(e) => onUnitChange(e.target.value)} className="min-h-[44px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink">
          <option value="">{t("screens.s20.pickUnit")}</option>
          {orgUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {locale === "en" ? u.nameEn : u.nameEl}
            </option>
          ))}
        </select>
      </label>

      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {!unitId ? (
        <p className="text-fs-16 text-k-text">{t("screens.s18plan.pickUnitFirst")}</p>
      ) : state === "loading" ? (
        <div aria-busy="true" className="h-s-12 animate-pulse rounded-k bg-k-grey" />
      ) : state === "error" ? (
        <div className="p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-s-4 min-h-[44px] rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">
              {t("common.retry")}
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-s-6">
          <AgreementCard
            key={agreement?.id ?? `new-${unitId}`}
            agreement={agreement}
            unitId={unitId}
            contractors={contractors}
            canManage={canManage}
            offline={offline}
            onSave={props.onSaveAgreement}
          />
          {agreement && (
            <>
              <CatalogueSection
                agreementId={agreement.id}
                systems={props.systems}
                state={props.systemsState}
                canManage={canManage && !offline}
                onPatch={props.onPatchSystem}
                onImport={props.onImport}
                onRetry={onRetry}
              />
              <SchedulesSection
                schedules={props.schedules}
                state={props.schedulesState}
                systems={props.systems ?? []}
                assets={props.assets}
                canManage={canManage}
                offline={offline}
                onSave={props.onSaveSchedule}
                onGenerate={props.onGenerate}
                onRetry={onRetry}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
