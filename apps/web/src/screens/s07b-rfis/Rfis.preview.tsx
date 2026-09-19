// S07b — R09

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildRfis } from "./fixture";
import { Rfis } from "./Rfis";

const noPermission = <NoPermission />;
const now = new Date("2026-09-19T09:00:00.000Z");
const contract = buildContractDetail({ rfisOpen: 2, rfisBreached: 1 });
const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s07b-rfis",
  title: "S07b Αιτήματα διευκρίνισης",
  states: {
    default: () => (
      <Rfis
        contract={contract}
        rfis={buildRfis(now)}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSelect={noop}
        onCreate={noop}
        onAnswer={noop}
        onCloseRfi={noop}
      />
    ),
    loading: () => <Rfis state="loading" noPermission={noPermission} onSelect={noop} onCreate={noop} onAnswer={noop} onCloseRfi={noop} />,
    empty: () => (
      <Rfis
        contract={contract}
        rfis={[]}
        state="empty"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSelect={noop}
        onCreate={noop}
        onAnswer={noop}
        onCloseRfi={noop}
      />
    ),
    error: () => <Rfis state="error" noPermission={noPermission} onSelect={noop} onCreate={noop} onAnswer={noop} onCloseRfi={noop} onRetry={noop} />,
    noPermission: () => <Rfis state="noPermission" noPermission={noPermission} onSelect={noop} onCreate={noop} onAnswer={noop} onCloseRfi={noop} />,
    offline: () => (
      <Rfis
        contract={contract}
        rfis={buildRfis(now)}
        state="offline"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSelect={noop}
        onCreate={noop}
        onAnswer={noop}
        onCloseRfi={noop}
      />
    ),
  },
  notes:
    "One breached (OPEN, red chip past due), one green OPEN and one CLOSED row whose Προθεσμία column shows " +
    "the answered date in mono instead of a chip — the clock stopped (ADR-0017).",
};

export default entry;
