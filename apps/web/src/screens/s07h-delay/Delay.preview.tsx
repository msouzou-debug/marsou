// S07h — ADR-0035

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "../s07-contract/fixture";
import { Delay } from "./Delay";

const noPermission = <NoPermission />;
const data = buildContractDetail();

const entry: PreviewEntry = {
  id: "s07h-delay",
  title: "S07h Προθεσμίες και ρήτρες",
  states: {
    default: () => <Delay data={data} state="default" noPermission={noPermission} roles={["admin"]} />,
    loading: () => <Delay state="loading" noPermission={noPermission} />,
    error: () => <Delay state="error" noPermission={noPermission} onRetry={() => undefined} />,
    noPermission: () => <Delay state="noPermission" noPermission={noPermission} />,
    offline: () => <Delay data={data} state="offline" noPermission={noPermission} roles={["admin"]} />,
  },
  notes:
    "Fixture: two sections (Α handed over four days late, Β open and 25 days late with its penalty activated), " +
    "two extensions (one the contractor's fault, one not). The «Ενεργοποίηση ρήτρας» button needs APPROVE on the contract record row.",
};

export default entry;
