import appShell from "@/components/app-shell/AppShell.preview";
import type { PreviewEntry } from "./types";
import areaPicker from "@/components/area-picker/AreaPicker.preview";
import assetBreadcrumb from "@/components/asset-breadcrumb/AssetBreadcrumb.preview";
import calendarGrid from "@/components/calendar-grid/CalendarGrid.preview";
import cashflowChart from "@/components/cashflow-chart/CashflowChart.preview";
import closeoutChecklist from "@/components/closeout-checklist/CloseoutChecklist.preview";
import conditionChip from "@/components/condition-chip/ConditionChip.preview";
import confirmDialog from "@/components/confirm-dialog/ConfirmDialog.preview";
import controlsChecklist from "@/components/controls-checklist/ControlsChecklist.preview";
import costBar from "@/components/cost-bar/CostBar.preview";
import criticalityChip from "@/components/criticality-chip/CriticalityChip.preview";
import decisionPanel from "@/components/decision-panel/DecisionPanel.preview";
import emptyState from "@/components/empty-state/EmptyState.preview";
import filterBar from "@/components/filter-bar/FilterBar.preview";
import forecastChart from "@/components/forecast-chart/ForecastChart.preview";
import helpDrawer from "@/components/help-drawer/HelpDrawer.preview";
import icraBadge from "@/components/icra-badge/IcraBadge.preview";
import icraMatrixGrid from "@/components/icra-matrix-grid/IcraMatrixGrid.preview";
import inboxList from "@/components/inbox-list/InboxList.preview";
import keyboardHintBar from "@/components/keyboard-hint-bar/KeyboardHintBar.preview";
import kpiTile from "@/components/kpi-tile/KpiTile.preview";
import labelSheet from "@/components/label-sheet/LabelSheet.preview";
import offlineChip from "@/components/offline-chip/OfflineChip.preview";
import permitBanner from "@/components/permit-banner/PermitBanner.preview";
import photoStrip from "@/components/photo-strip/PhotoStrip.preview";
import ragChip from "@/components/rag-chip/RagChip.preview";
import slaChip from "@/components/sla-chip/SlaChip.preview";
import suggestionPanel from "@/components/suggestion-panel/SuggestionPanel.preview";
import table from "@/components/table/Table.preview";
import tierChip from "@/components/tier-chip/TierChip.preview";
import timeline from "@/components/timeline/Timeline.preview";
import warningStrip from "@/components/warning-strip/WarningStrip.preview";
import wizardShell from "@/components/wizard-shell/WizardShell.preview";
import s01Portfolio from "@/screens/s01-portfolio/Portfolio.preview";
import s02aProjectForm from "@/screens/s02a-project-form/ProjectForm.preview";
import s17aAssetForm from "@/screens/s17a-asset-form/AssetForm.preview";
import s02Projects from "@/screens/s02-projects/Projects.preview";
import s03Project from "@/screens/s03-project/ProjectOverview.preview";
import s03PhaseDialog from "@/screens/s03-project/PhaseDialog.preview";
import s04Cost from "@/screens/s04-cost/Cost.preview";
import s05Schedule from "@/screens/s05-schedule/Schedule.preview";
import s06RisksIssues from "@/screens/s06-risks-issues/RisksIssues.preview";
import s07Contract from "@/screens/s07-contract/ContractOverview.preview";
import s07aContractForm from "@/screens/s07a-contract-form/ContractForm.preview";
import s07bRfis from "@/screens/s07b-rfis/Rfis.preview";
import s07cInstructions from "@/screens/s07c-instructions/Instructions.preview";
import s07dDefects from "@/screens/s07d-defects/Defects.preview";
import s07eContracts from "@/screens/s07e-contracts/Contracts.preview";
import s08Variations from "@/screens/s08-variations/Variations.preview";
import s09PaymentCerts from "@/screens/s09-payment-certs/PaymentCerts.preview";
import s09CertificateDetail from "@/screens/s09-payment-certs/CertificateDetail.preview";
import s09aAccruals from "@/screens/s09a-accruals/Accruals.preview";
import s10Imports from "@/screens/s10-sap-import/Imports.preview";
import s10UnmatchedQueue from "@/screens/s10-sap-import/UnmatchedQueue.preview";
import s24Contractors from "@/screens/s24-contractors/Contractors.preview";
import s24Users from "@/screens/s24-users/Users.preview";
import s26HelpCentre from "@/screens/s26-help-centre/GuideIndexTable.preview";
import s26ScreenTierList from "@/screens/s26-help-centre/ScreenTierList.preview";

// Every component adds its `<Name>.preview.tsx` default export here.
// Keep alphabetical. The gallery at /preview reads this list.
const entries: PreviewEntry[] = [
  appShell,
  areaPicker,
  assetBreadcrumb,
  calendarGrid,
  cashflowChart,
  closeoutChecklist,
  conditionChip,
  confirmDialog,
  controlsChecklist,
  costBar,
  criticalityChip,
  decisionPanel,
  emptyState,
  filterBar,
  forecastChart,
  helpDrawer,
  icraBadge,
  icraMatrixGrid,
  inboxList,
  keyboardHintBar,
  kpiTile,
  labelSheet,
  offlineChip,
  permitBanner,
  photoStrip,
  ragChip,
  slaChip,
  suggestionPanel,
  table,
  tierChip,
  timeline,
  warningStrip,
  wizardShell,
  s01Portfolio,
  s02aProjectForm,
  s17aAssetForm,
  s02Projects,
  s03Project,
  s03PhaseDialog,
  s04Cost,
  s05Schedule,
  s06RisksIssues,
  s07Contract,
  s07aContractForm,
  s07bRfis,
  s07cInstructions,
  s07dDefects,
  s07eContracts,
  s08Variations,
  s09PaymentCerts,
  s09CertificateDetail,
  s09aAccruals,
  s10Imports,
  s10UnmatchedQueue,
  s24Contractors,
  s24Users,
  s26HelpCentre,
  s26ScreenTierList,
];

export function getPreviewEntries(): PreviewEntry[] {
  return entries;
}

export function getPreviewEntry(id: string): PreviewEntry | undefined {
  return entries.find((e) => e.id === id);
}
