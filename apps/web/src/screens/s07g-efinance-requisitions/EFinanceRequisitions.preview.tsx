// S07g — ADR-0029

import { NoPermission } from "@/components/app-shell";
import { buildEFinanceRequisitionList } from "@/mocks/efinance";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "@/screens/s07-contract/fixture";
import { EFinanceRequisitions } from "./EFinanceRequisitions";

const noPermission = <NoPermission />;
const noop = () => undefined;
const contract = buildContractDetail();
const list = buildEFinanceRequisitionList();

const entry: PreviewEntry = {
  id: "s07g-efinance-requisitions",
  title: "S07g Αιτήματα eFinance",
  states: {
    default: () => <EFinanceRequisitions contract={contract} list={list} state="default" noPermission={noPermission} />,
    loading: () => <EFinanceRequisitions contract={contract} state="loading" noPermission={noPermission} />,
    empty: () => (
      <EFinanceRequisitions contract={contract} list={{ configured: true, items: [], total: 0 }} state="empty" noPermission={noPermission} />
    ),
    error: () => <EFinanceRequisitions contract={contract} state="error" noPermission={noPermission} onRetry={noop} />,
    noPermission: () => <EFinanceRequisitions state="noPermission" noPermission={noPermission} />,
    offline: () => <EFinanceRequisitions contract={contract} list={list} state="offline" noPermission={noPermission} />,
  },
  notes:
    "The second requisition has no description and no amount, so the fixture shows «—» rather than 0. " +
    "`status` is eFinance's own word and is shown as sent. Cards under 1024px.",
};

export default entry;
