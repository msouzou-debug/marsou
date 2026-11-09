// S07i — ADR-0035

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "../s07-contract/fixture";
import { Claims } from "./Claims";

const noPermission = <NoPermission />;
const data = buildContractDetail();

const entry: PreviewEntry = {
  id: "s07i-claims",
  title: "S07i Αξιώσεις",
  states: {
    default: () => <Claims data={data} state="default" noPermission={noPermission} roles={["estates_head"]} />,
    loading: () => <Claims state="loading" noPermission={noPermission} />,
    error: () => <Claims state="error" noPermission={noPermission} onRetry={() => undefined} />,
    noPermission: () => <Claims state="noPermission" noPermission={noPermission} />,
    offline: () => <Claims data={data} state="offline" noPermission={noPermission} roles={["estates_head"]} />,
  },
  notes: "Fixture: a contractor claim under review (contingent liability), an Organisation claim just notified, and a settled one that is not counted as open.",
};

export default entry;
