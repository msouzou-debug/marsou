// S07d — R12, R35

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildDefects } from "./fixture";
import { Defects } from "./Defects";

const noPermission = <NoPermission />;
const defects = buildDefects();
const contract = buildContractDetail();
const today = new Date("2026-09-19");
const areaNameById = new Map([["area-1", "Πλυντήριο ασθενοφόρων"]]);
const projectById = new Map([["project-2", { id: "project-2", code: "LAR-2026-032", titleEl: "Ανακαίνιση σταθμού ασθενοφόρων" }]]);
const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s07d-defects",
  title: "S07d Ελλείψεις",
  states: {
    default: () => (
      <Defects
        contract={contract}
        defects={defects}
        areaNameById={areaNameById}
        projectById={projectById}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        today={today}
        onSelect={noop}
        onCreate={noop}
        onUpdate={noop}
      />
    ),
    loading: () => <Defects state="loading" noPermission={noPermission} onSelect={noop} onCreate={noop} onUpdate={noop} />,
    empty: () => (
      <Defects contract={contract} defects={[]} state="empty" noPermission={noPermission} roles={["project_engineer"]} onSelect={noop} onCreate={noop} onUpdate={noop} />
    ),
    error: () => <Defects state="error" noPermission={noPermission} onSelect={noop} onCreate={noop} onUpdate={noop} onRetry={noop} />,
    noPermission: () => <Defects state="noPermission" noPermission={noPermission} onSelect={noop} onCreate={noop} onUpdate={noop} />,
    offline: () => (
      <Defects
        contract={contract}
        defects={defects}
        areaNameById={areaNameById}
        projectById={projectById}
        state="offline"
        noPermission={noPermission}
        roles={["project_engineer"]}
        today={today}
        onSelect={noop}
        onCreate={noop}
        onUpdate={noop}
      />
    ),
  },
  notes:
    "One row per NHS ERIC band (HIGH funded and linked, SIGNIFICANT overdue with an unmapped area id, " +
    "MODERATE, LOW closed). The footer line sums count and cost per band, mono.",
};

export default entry;
