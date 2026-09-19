// S07 — R08, R10, R31

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { ContractOverview } from "./ContractOverview";
import { buildContractDetail } from "./fixture";

const noPermission = <NoPermission />;
const today = new Date("2026-09-19");
const data = buildContractDetail();

const entry: PreviewEntry = {
  id: "s07-contract",
  title: "S07 Σύμβαση",
  states: {
    default: () => (
      <ContractOverview data={data} state="default" noPermission={noPermission} roles={["project_engineer"]} today={today} />
    ),
    loading: () => <ContractOverview state="loading" noPermission={noPermission} />,
    error: () => <ContractOverview state="error" noPermission={noPermission} onRetry={() => undefined} />,
    noPermission: () => <ContractOverview state="noPermission" noPermission={noPermission} />,
    offline: () => (
      <ContractOverview data={data} state="offline" noPermission={noPermission} roles={["project_engineer"]} today={today} />
    ),
  },
  notes:
    "Fixture: contract ΤΥ/2026/031 on «Αντικατάσταση οχημάτων ασθενοφόρων» (Λάρνακα, PRJ-031 in the seed), " +
    "deliberately past the 10% variation warning (14,0 %) so the red figure and the warnings strip both " +
    "have something to show. No empty state — a detail page always names one contract or shows " +
    "noPermission/error for it, same reasoning as S03's own ProjectOverview.",
};

export default entry;
