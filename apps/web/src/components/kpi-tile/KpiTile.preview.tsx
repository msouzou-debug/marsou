import type { PreviewEntry } from "@/preview/types";
import { KpiTile } from "./KpiTile";

// Greek sample data mirrors S01's KPI row (UI instructions §5).
const entry: PreviewEntry = {
  id: "kpi-tile",
  title: "KpiTile",
  states: {
    default: () => (
      <div className="grid grid-cols-2 gap-s-4 max-w-[520px]">
        <KpiTile label="Εγκεκριμένος προϋπολογισμός" value="4.250.000 €" comparator="% έτους που έχει παρέλθει: 62 %" />
        <KpiTile label="Δαπάνες" value="2.980.000 €" comparator="70 % του προϋπολογισμού" trend="up" />
        <KpiTile label="Δεσμεύσεις" value="3.610.000 €" comparator="85 % του προϋπολογισμού" trend="down" />
      </div>
    ),
    loading: () => (
      <div className="max-w-[260px]">
        <KpiTile label="Πρόβλεψη τελικού κόστους" value="" state="loading" />
      </div>
    ),
    error: () => (
      <div className="max-w-[260px]">
        <KpiTile label="Πρόβλεψη τελικού κόστους" value="" state="error" onRetry={() => {}} />
      </div>
    ),
  },
  notes:
    "Only default, loading and error apply (UI instructions §4): a KpiTile renders a value its " +
    "parent already resolved, so it has no empty, no-permission or offline state of its own.",
};

export default entry;
