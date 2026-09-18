import type { PreviewEntry } from "@/preview/types";
import { CostBar } from "./CostBar";

// Fake round figures for a fake project, «Ανακαίνιση χειρουργείων Γ.Ν. Λάρνακας».
const withinBudget = { approved: 2_400_000, committed: 2_150_000, spent: 1_274_000, forecast: 2_320_000 };
const overBudget = { approved: 2_400_000, committed: 2_610_000, spent: 1_880_000, forecast: 2_685_000 };
const pendingSap = { approved: 2_400_000, committed: null, spent: null, forecast: null };

const entry: PreviewEntry = {
  id: "cost-bar",
  title: "CostBar",
  states: {
    default: () => (
      <div className="grid gap-s-10">
        <CostBar {...withinBudget} />
        <CostBar {...overBudget} />
        <CostBar {...pendingSap} />
      </div>
    ),
    loading: () => <CostBar {...withinBudget} state="loading" />,
    empty: () => <CostBar approved={0} committed={0} spent={0} forecast={0} state="empty" />,
    error: () => <CostBar {...withinBudget} state="error" />,
  },
  notes:
    "Three bars in the default panel: the first is inside budget, the second shows " +
    "the overflow rule — commitments of € 2.610.000 against € 2.400.000 approved, " +
    "so the bar runs past the approved line and the overrun is hatched in --k-red " +
    "and written out as «Υπέρβαση € 210.000». The hatch and the written amount are " +
    "there so the rule survives greyscale print. The third has committed/spent/forecast " +
    "all null (S03, contract ProjectLedgers pre-SAP-import): only the approved track " +
    "draws, the legend shows «—» rather than € 0, and a 14px line explains why. No " +
    "permission and offline are skipped: the bar holds no controls and no writes, so " +
    "offline shows the cached figures unchanged and access is decided by the screen " +
    "that renders it.",
};

export default entry;
