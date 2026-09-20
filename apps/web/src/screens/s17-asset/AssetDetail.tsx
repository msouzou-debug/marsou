"use client";

// S17 — R26–R30, R45
//
/**
 * AssetDetail — the pure S17 asset record screen body (M4 build brief item
 * 3). `AssetBreadcrumb` on top; facts in two columns; a `CostBar` variant for
 * the whole-life cost; a «Φυσική κατάσταση» block with an inline recording
 * form; children, documents, readings, history, open permits/defects and the
 * QR label preview.
 *
 * | Prop                   | Type              | Notes                                                              |
 * |------------------------|-------------------|------------------------------------------------------------------------|
 * | asset                  | AssetDetail?      | Ignored in `noPermission` \| `loading` \| `error`.                       |
 * | state                  | AssetDetailState  | No `empty` — a record page always names one asset or none at all.       |
 * | assetUrl               | string            | The `/a/<tag>` scan URL — the QR label preview's payload.               |
 * | canWrite               | boolean           | `canWriteAssets` — shows «Επεξεργασία».                                 |
 * | canRecordCondition     | boolean           | `canRecordAssetCondition` — shows the condition/reading forms.          |
 * | canUploadDocuments     | boolean           | `canUploadAssetDocuments` — shows the document upload form.             |
 * | condition/reading/document forms | —       | Each inline form's own value/saving/error, owned by the Screen.        |
 *
 * RULE (build brief item 3 / contract `AssetDetail.wholeLife`): a `null`
 * `capitalCost` renders «—» facts, never a `CostBar` forced to a fabricated
 * `0` — `CostBar.approved` is a required number, so there is nothing correct
 * to hand it once the acquisition cost itself is unknown (see the whole-life
 * block below).
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import type { AssetDetail as AssetDetailType, AssetDocumentKind, Condition } from "@ecapital/shared";
import { useTranslations } from "next-intl";
import { AssetBreadcrumb, type AssetBreadcrumbSegment } from "@/components/asset-breadcrumb";
import { ConditionChip } from "@/components/condition-chip";
import { CostBar } from "@/components/cost-bar";
import { CriticalityChip } from "@/components/criticality-chip";
import { LabelSheet } from "@/components/label-sheet";
import { PageTitle } from "@/components/app-shell";
import { Timeline } from "@/components/timeline";
import { formatDate, formatEURorDash, formatInt } from "@/lib/format";

export type AssetDetailState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface ConditionFormValue {
  condition: Condition;
  assessedAt: string;
  noteEl: string;
}

export interface ReadingFormValue {
  takenAt: string;
  readingType: string;
  value: string;
  unit: string;
}

export interface DocumentFormValue {
  kind: AssetDocumentKind;
  titleEl: string;
  file: File | null;
}

export interface AssetDetailProps {
  asset?: AssetDetailType;
  state: AssetDetailState;
  assetUrl: string;
  onRetry?: () => void;
  noPermission: ReactNode;
  canWrite: boolean;
  canRecordCondition: boolean;
  canUploadDocuments: boolean;

  conditionForm: ConditionFormValue;
  onConditionFormChange: (next: ConditionFormValue) => void;
  conditionSaving: boolean;
  conditionError?: string;
  onSubmitCondition: () => void;

  readingForm: ReadingFormValue;
  onReadingFormChange: (next: ReadingFormValue) => void;
  readingSaving: boolean;
  readingError?: string;
  onSubmitReading: () => void;

  documentSheetOpen: boolean;
  onOpenDocumentSheet: () => void;
  onCloseDocumentSheet: () => void;
  documentForm: DocumentFormValue;
  onDocumentFormChange: (next: DocumentFormValue) => void;
  documentUploading: boolean;
  documentError?: string;
  onSubmitDocument: () => void;
}

const CONDITION_OPTIONS: Condition[] = ["A", "B", "C", "D", "E"];
const DOCUMENT_KIND_OPTIONS: AssetDocumentKind[] = ["OM_MANUAL", "CERT", "COMMISSIONING", "WARRANTY", "DRAWING", "PHOTO"];

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-20 text-k-blue-deep">{title}</h2>
      <div className="mt-s-3">{children}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-fs-12 text-k-text">{label}</dt>
      <dd className="text-fs-16 text-k-ink">{value}</dd>
    </div>
  );
}

export function AssetDetail(props: AssetDetailProps) {
  const {
    asset,
    state,
    assetUrl,
    onRetry,
    noPermission,
    canWrite,
    canRecordCondition,
    canUploadDocuments,
    conditionForm,
    onConditionFormChange,
    conditionSaving,
    conditionError,
    onSubmitCondition,
    readingForm,
    onReadingFormChange,
    readingSaving,
    readingError,
    onSubmitReading,
    documentSheetOpen,
    onOpenDocumentSheet,
    onCloseDocumentSheet,
    documentForm,
    onDocumentFormChange,
    documentUploading,
    documentError,
    onSubmitDocument,
  } = props;
  const t = useTranslations();
  const [fileInputKey, setFileInputKey] = useState(0);

  if (state === "noPermission") return <>{noPermission}</>;
  if (state === "loading" || !asset) {
    return <div aria-busy="true" className="h-s-12 animate-pulse rounded-k bg-k-grey" />;
  }
  if (state === "error") {
    return (
      <div className="p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  // RULE (AssetBreadcrumb, CAPEX-02 §5): Μονάδα › Κτίριο › Όροφος › Χώρος ›
  // Πάγιο, in hierarchy order — a caller only ever supplies a contiguous
  // prefix of it, never skips a level, same as S16's own breadcrumb.
  const segments: AssetBreadcrumbSegment[] = [{ value: asset.orgUnitNameEl, href: `/units/${encodeURIComponent(asset.orgUnitId)}/areas` }];
  const unitHref = segments[0].href;
  // RULE: no building/floor page exists yet (same TODO `s16-areas/page.tsx`
  // flags), so both link back to the unit's own area tree — with distinct
  // hrefs (a harmless `#` fragment each) only so AssetBreadcrumb's own
  // `key={segment.href}` on the collapsed middle segments stays unique.
  if (asset.buildingCode) segments.push({ value: asset.buildingCode, href: `${unitHref}#building` });
  if (asset.floorCode) segments.push({ value: asset.floorCode, href: `${unitHref}#floor` });
  if (asset.areaNameEl) {
    segments.push({
      value: asset.areaNameEl,
      href: `/assets?unit=${encodeURIComponent(asset.orgUnitId)}&areaId=${encodeURIComponent(asset.areaId ?? "")}`,
    });
  }
  segments.push({ value: asset.nameEl, href: `/assets/${encodeURIComponent(asset.id)}` });

  const label = { assetId: asset.id, tag: asset.tag, nameEl: asset.nameEl, areaNameEl: asset.areaNameEl, url: assetUrl };

  return (
    <>
      <AssetBreadcrumb segments={segments} />
      <div className="mt-s-4">
        <PageTitle
          eyebrow={<span className="font-k-mono">{asset.tag}</span>}
          title={asset.nameEl}
          action={
            state !== "offline" && canWrite ? (
              <Link href={`/assets/${encodeURIComponent(asset.id)}/edit`} className="rounded-k border border-k-grey px-s-4 py-s-2 text-fs-14 text-k-blue-deep">
                {t("buttons.edit")}
              </Link>
            ) : undefined
          }
        />
      </div>

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="grid grid-cols-1 gap-s-6 desktop:grid-cols-2">
        <div className="grid gap-s-5 self-start">
          <Card title={t("screens.s17.identityTitle")}>
            <div className="grid grid-cols-2 gap-s-4">
              <Fact label={t("screens.s17.facts.class")} value={t(`assetClass.${asset.assetClass}`)} />
              <Fact label={t("common.status")} value={t(`assetStatus.${asset.status}`)} />
              <Fact label={t("screens.s17.facts.criticality")} value={<CriticalityChip value={asset.criticality as 1 | 2 | 3 | 4 | 5} />} />
              <Fact label={t("common.condition")} value={<ConditionChip value={asset.condition} />} />
              <Fact label={t("screens.s17.facts.manufacturer")} value={asset.manufacturer ?? t("common.notAvailable")} />
              <Fact label={t("screens.s17.facts.model")} value={asset.model ?? t("common.notAvailable")} />
              <Fact label={t("screens.s17.facts.serialNo")} value={asset.serialNo ?? t("common.notAvailable")} />
              <Fact label={t("screens.s17.facts.installedDate")} value={asset.installedDate ? formatDate(asset.installedDate) : t("common.notAvailable")} />
              <Fact label={t("screens.s17.facts.commissionedDate")} value={asset.commissionedDate ? formatDate(asset.commissionedDate) : t("common.notAvailable")} />
              <Fact label={t("screens.s17.facts.warrantyEnd")} value={asset.warrantyEnd ? formatDate(asset.warrantyEnd) : t("common.notAvailable")} />
              <Fact
                label={t("screens.s17.facts.sourceProject")}
                value={asset.sourceProjectId ? <Link href={`/projects/${encodeURIComponent(asset.sourceProjectId)}`} className="text-k-blue hover:underline">{asset.sourceProjectCode ?? asset.sourceProjectId}</Link> : t("common.notAvailable")}
              />
              <Fact
                label={t("screens.s17.facts.sourceContract")}
                value={asset.sourceContractId ? <Link href={`/contracts/${encodeURIComponent(asset.sourceContractId)}`} className="text-k-blue hover:underline">{asset.sourceContractRef ?? asset.sourceContractId}</Link> : t("common.notAvailable")}
              />
              <Fact label={t("screens.s17.facts.costCentre")} value={asset.costCentre ?? t("common.notAvailable")} />
              <Fact label={t("screens.s17.facts.sapAssetNo")} value={asset.sapAssetNo ?? t("common.notAvailable")} />
              {asset.system && <Fact label={t("screens.s17.facts.system")} value={t(`permitSystem.${asset.system}`)} />}
              {asset.parentTag && (
                <Fact
                  label={t("screens.s17.facts.parentAsset")}
                  value={asset.parentAssetId ? <Link href={`/assets/${encodeURIComponent(asset.parentAssetId)}`} className="font-k-mono text-k-blue hover:underline">{asset.parentTag}</Link> : asset.parentTag}
                />
              )}
              <Fact label={t("screens.s17.facts.replacementYear")} value={asset.replacementYear === null ? t("common.notAvailable") : formatInt(asset.replacementYear)} />
            </div>
          </Card>

          <Card title={t("screens.s17.wholeLifeTitle")}>
            {asset.wholeLife.capitalCost === null ? (
              <div className="grid gap-s-2">
                <p className="text-fs-14 text-k-text">{t("screens.s17.wholeLife.noCapitalCost")}</p>
                <Fact label={t("screens.s17.wholeLife.maintenanceToDate")} value={formatEURorDash(asset.wholeLife.maintenanceToDate)} />
                <Fact label={t("screens.s17.wholeLife.replacementCostEst")} value={formatEURorDash(asset.wholeLife.replacementCostEst)} />
              </div>
            ) : (
              <CostBar
                approved={asset.wholeLife.capitalCost}
                committed={null}
                spent={asset.wholeLife.maintenanceToDate}
                forecast={asset.wholeLife.replacementCostEst}
                labels={{
                  approved: t("screens.s17.wholeLife.capitalCost"),
                  spent: t("screens.s17.wholeLife.maintenanceToDate"),
                  forecast: t("screens.s17.wholeLife.replacementCostEst"),
                }}
              />
            )}
            <p className="mt-s-3 text-fs-14 text-k-text">
              {asset.wholeLife.ageYears === null
                ? t("screens.s17.wholeLife.ageUnknown")
                : t("screens.s17.wholeLife.age", { years: formatInt(asset.wholeLife.ageYears) })}
              {asset.wholeLife.remainingLifeYears !== null && (
                <> · {t("screens.s17.wholeLife.remainingLife", { years: formatInt(asset.wholeLife.remainingLifeYears) })}</>
              )}
            </p>
          </Card>

          <Card title={t("screens.s17.conditionTitle")}>
            <div className="flex items-center gap-s-3">
              <ConditionChip value={asset.condition} />
              <p className="text-fs-14 text-k-text">
                {asset.conditionAssessedAt
                  ? t("screens.s17.condition.assessedAt", { date: formatDate(asset.conditionAssessedAt) })
                  : t("screens.s17.condition.notAssessed")}
              </p>
            </div>

            {canRecordCondition && state !== "offline" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onSubmitCondition();
                }}
                className="mt-s-4 grid gap-s-3 border-t border-k-grey pt-s-4"
              >
                <p className="text-fs-14 font-bold text-k-blue-deep">{t("screens.s17.condition.recordTitle")}</p>
                <div className="grid grid-cols-1 gap-s-3 tablet:grid-cols-3">
                  <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                    {t("screens.s17.condition.conditionLabel")}
                    <select
                      value={conditionForm.condition}
                      onChange={(e) => onConditionFormChange({ ...conditionForm, condition: e.target.value as Condition })}
                      className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                    >
                      {CONDITION_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                    {t("screens.s17.condition.assessedAtLabel")}
                    <input
                      type="date"
                      value={conditionForm.assessedAt}
                      onChange={(e) => onConditionFormChange({ ...conditionForm, assessedAt: e.target.value })}
                      className="num h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                    />
                  </label>
                  <label className="flex flex-col gap-s-1 text-fs-14 text-k-text tablet:col-span-1">
                    {t("screens.s17.condition.noteLabel")}
                    <input
                      type="text"
                      value={conditionForm.noteEl}
                      onChange={(e) => onConditionFormChange({ ...conditionForm, noteEl: e.target.value })}
                      className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                    />
                  </label>
                </div>
                {conditionError && <p role="alert" className="text-fs-14 text-k-red">{conditionError}</p>}
                <div>
                  <button
                    type="submit"
                    disabled={conditionSaving}
                    className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
                  >
                    {conditionSaving ? t("screens.s17a.saving") : t("screens.s17.condition.submit")}
                  </button>
                </div>
              </form>
            )}
          </Card>

          <Card title={t("screens.s17.childrenTitle")}>
            {asset.children.length === 0 ? (
              <p className="text-fs-14 text-k-text">{t("screens.s17.childrenEmpty")}</p>
            ) : (
              <ul className="grid gap-s-2">
                {asset.children.map((child) => (
                  <li key={child.id}>
                    <Link href={`/assets/${encodeURIComponent(child.id)}`} className="flex items-center gap-s-2 text-fs-14">
                      <span className="font-k-mono text-k-blue">{child.tag}</span>
                      <span className="text-k-ink">{child.nameEl}</span>
                      <span className="text-k-text">{t(`assetClass.${child.assetClass}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-s-5 self-start">
          <Card title={t("screens.s17.documentsTitle")}>
            {asset.documents.length === 0 ? (
              <p className="text-fs-14 text-k-text">{t("screens.s17.documentsEmpty")}</p>
            ) : (
              <ul className="grid gap-s-2">
                {asset.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-s-2 border-b border-k-grey pb-s-2">
                    <span className="text-fs-14 text-k-ink">
                      {t(`assetDocumentKind.${doc.kind}`)} — {doc.titleEl}
                    </span>
                    <span className="num text-fs-12 text-k-text">
                      {doc.protocolNumber ?? t("screens.s17.pendingFiling")}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {canUploadDocuments && state !== "offline" && (
              <div className="mt-s-4 border-t border-k-grey pt-s-4">
                {!documentSheetOpen ? (
                  <button type="button" onClick={onOpenDocumentSheet} className="text-fs-14 text-k-blue">
                    {t("screens.s17.uploadDocument")}
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onSubmitDocument();
                    }}
                    className="grid gap-s-3"
                  >
                    <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                      {t("screens.s17.documentForm.kind")}
                      <select
                        value={documentForm.kind}
                        onChange={(e) => onDocumentFormChange({ ...documentForm, kind: e.target.value as AssetDocumentKind })}
                        className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                      >
                        {DOCUMENT_KIND_OPTIONS.map((k) => (
                          <option key={k} value={k}>
                            {t(`assetDocumentKind.${k}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                      {t("screens.s17.documentForm.title")}
                      <input
                        type="text"
                        value={documentForm.titleEl}
                        onChange={(e) => onDocumentFormChange({ ...documentForm, titleEl: e.target.value })}
                        className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                      />
                    </label>
                    <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                      {t("screens.s17.documentForm.file")}
                      <input
                        key={fileInputKey}
                        type="file"
                        onChange={(e) => onDocumentFormChange({ ...documentForm, file: e.target.files?.[0] ?? null })}
                        className="text-fs-14"
                      />
                    </label>
                    {documentError && <p role="alert" className="text-fs-14 text-k-red">{documentError}</p>}
                    <div className="flex gap-s-3">
                      <button
                        type="submit"
                        disabled={documentUploading || !documentForm.file}
                        className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
                      >
                        {documentUploading ? t("screens.s17a.saving") : t("buttons.save")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFileInputKey((k) => k + 1);
                          onCloseDocumentSheet();
                        }}
                        className="rounded-k px-s-4 py-s-2 text-fs-14 text-k-text"
                      >
                        {t("buttons.cancel")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </Card>

          <Card title={t("screens.s17.readingsTitle")}>
            {asset.readings.length === 0 ? (
              <p className="text-fs-14 text-k-text">{t("screens.s17.readingsEmpty")}</p>
            ) : (
              <table className="w-full border-collapse text-fs-14">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-k-grey px-s-2 py-s-1 text-left font-bold text-k-blue-deep">{t("screens.s17.readingForm.takenAt")}</th>
                    <th scope="col" className="border-b border-k-grey px-s-2 py-s-1 text-left font-bold text-k-blue-deep">{t("screens.s17.readingForm.readingType")}</th>
                    <th scope="col" className="num border-b border-k-grey px-s-2 py-s-1 font-bold text-k-blue-deep">{t("screens.s17.readingForm.value")}</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.readings.map((r) => (
                    <tr key={r.id}>
                      <td className="num border-b border-k-grey px-s-2 py-s-1">{formatDate(r.takenAt)}</td>
                      <td className="border-b border-k-grey px-s-2 py-s-1">{r.readingType}</td>
                      <td className="num border-b border-k-grey px-s-2 py-s-1">
                        {r.value}
                        {r.unit ? ` ${r.unit}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canRecordCondition && state !== "offline" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onSubmitReading();
                }}
                className="mt-s-4 grid grid-cols-1 gap-s-3 border-t border-k-grey pt-s-4 tablet:grid-cols-4"
              >
                <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                  {t("screens.s17.readingForm.takenAt")}
                  <input
                    type="date"
                    value={readingForm.takenAt}
                    onChange={(e) => onReadingFormChange({ ...readingForm, takenAt: e.target.value })}
                    className="num h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                  />
                </label>
                <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                  {t("screens.s17.readingForm.readingType")}
                  <input
                    type="text"
                    value={readingForm.readingType}
                    onChange={(e) => onReadingFormChange({ ...readingForm, readingType: e.target.value })}
                    placeholder={t("screens.s17.readingForm.readingTypePlaceholder")}
                    className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                  />
                </label>
                <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                  {t("screens.s17.readingForm.value")}
                  <input
                    type="number"
                    value={readingForm.value}
                    onChange={(e) => onReadingFormChange({ ...readingForm, value: e.target.value })}
                    className="num h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                  />
                </label>
                <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                  {t("screens.s17.readingForm.unit")}
                  <input
                    type="text"
                    value={readingForm.unit}
                    onChange={(e) => onReadingFormChange({ ...readingForm, unit: e.target.value })}
                    className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
                  />
                </label>
                {readingError && <p role="alert" className="text-fs-14 text-k-red tablet:col-span-4">{readingError}</p>}
                <div className="tablet:col-span-4">
                  <button
                    type="submit"
                    disabled={readingSaving}
                    className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
                  >
                    {readingSaving ? t("screens.s17a.saving") : t("screens.s17.readingForm.submit")}
                  </button>
                </div>
              </form>
            )}
          </Card>

          <Card title={t("screens.s17.openPermitsTitle")}>
            {asset.openPermits.length === 0 ? (
              <p className="text-fs-14 text-k-text">{t("screens.s17.openPermitsEmpty")}</p>
            ) : (
              <ul className="grid gap-s-2">
                {asset.openPermits.map((permit) => (
                  <li key={permit.id}>
                    <Link href={`/permits/${encodeURIComponent(permit.id)}`} className="flex items-center gap-s-2 text-fs-14">
                      <span className="font-k-mono text-k-blue">{permit.ref ?? permit.id}</span>
                      <span className="text-k-text">{t(`permitStatus.${permit.status}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s17.openDefects", { count: asset.openDefects })}</p>
          </Card>

          <Card title={t("screens.s17.qrTitle")}>
            <div className="flex items-center gap-s-4">
              <LabelSheet labels={[label]} variant="single" />
              <a
                href={`/assets/labels?ids=${encodeURIComponent(asset.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
              >
                <Printer size={20} strokeWidth={1.5} aria-hidden="true" />
                {t("screens.s17.printLabel")}
              </a>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-s-6 rounded-k border border-k-grey bg-k-white p-s-4">
        <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s17.historyTitle")}</h2>
        <div className="mt-s-3">
          <Timeline
            entries={asset.history.map((h, i) => ({
              id: `${h.at}-${i}`,
              actor: h.actorName ?? "",
              action: h.summaryEl,
              timestamp: h.at,
            }))}
          />
        </div>
      </div>
    </>
  );
}
