import type { PreviewEntry } from "./types";
import costBar from "@/components/cost-bar/CostBar.preview";
import icraBadge from "@/components/icra-badge/IcraBadge.preview";
import kpiTile from "@/components/kpi-tile/KpiTile.preview";
import offlineChip from "@/components/offline-chip/OfflineChip.preview";
import permitBanner from "@/components/permit-banner/PermitBanner.preview";
import ragChip from "@/components/rag-chip/RagChip.preview";
import slaChip from "@/components/sla-chip/SlaChip.preview";
import table from "@/components/table/Table.preview";

// Every component adds its `<Name>.preview.tsx` default export here.
// Keep alphabetical. The gallery at /preview reads this list.
const entries: PreviewEntry[] = [costBar, icraBadge, kpiTile, offlineChip, permitBanner, ragChip, slaChip, table];

export function getPreviewEntries(): PreviewEntry[] {
  return entries;
}

export function getPreviewEntry(id: string): PreviewEntry | undefined {
  return entries.find((e) => e.id === id);
}
