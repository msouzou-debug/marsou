import appShell from "@/components/app-shell/AppShell.preview";
import type { PreviewEntry } from "./types";
import assetBreadcrumb from "@/components/asset-breadcrumb/AssetBreadcrumb.preview";
import confirmDialog from "@/components/confirm-dialog/ConfirmDialog.preview";
import costBar from "@/components/cost-bar/CostBar.preview";
import decisionPanel from "@/components/decision-panel/DecisionPanel.preview";
import emptyState from "@/components/empty-state/EmptyState.preview";
import filterBar from "@/components/filter-bar/FilterBar.preview";
import helpDrawer from "@/components/help-drawer/HelpDrawer.preview";
import icraBadge from "@/components/icra-badge/IcraBadge.preview";
import kpiTile from "@/components/kpi-tile/KpiTile.preview";
import offlineChip from "@/components/offline-chip/OfflineChip.preview";
import permitBanner from "@/components/permit-banner/PermitBanner.preview";
import photoStrip from "@/components/photo-strip/PhotoStrip.preview";
import ragChip from "@/components/rag-chip/RagChip.preview";
import slaChip from "@/components/sla-chip/SlaChip.preview";
import table from "@/components/table/Table.preview";
import timeline from "@/components/timeline/Timeline.preview";
import wizardShell from "@/components/wizard-shell/WizardShell.preview";
import s01Portfolio from "@/screens/s01-portfolio/Portfolio.preview";
import s02Projects from "@/screens/s02-projects/Projects.preview";
import s03Project from "@/screens/s03-project/ProjectOverview.preview";

// Every component adds its `<Name>.preview.tsx` default export here.
// Keep alphabetical. The gallery at /preview reads this list.
const entries: PreviewEntry[] = [
  appShell,
  assetBreadcrumb,
  confirmDialog,
  costBar,
  decisionPanel,
  emptyState,
  filterBar,
  helpDrawer,
  icraBadge,
  kpiTile,
  offlineChip,
  permitBanner,
  photoStrip,
  ragChip,
  slaChip,
  table,
  timeline,
  wizardShell,
  s01Portfolio,
  s02Projects,
  s03Project,
];

export function getPreviewEntries(): PreviewEntry[] {
  return entries;
}

export function getPreviewEntry(id: string): PreviewEntry | undefined {
  return entries.find((e) => e.id === id);
}
