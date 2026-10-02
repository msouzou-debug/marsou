// S07f — ADR-0029

import { NoPermission } from "@/components/app-shell";
import { buildEFinanceInvoiceList } from "@/mocks/efinance";
import type { PreviewEntry } from "@/preview/types";
import { buildContractDetail } from "@/screens/s07-contract/fixture";
import { EFinanceInvoices } from "./EFinanceInvoices";

const noPermission = <NoPermission />;
const noop = () => undefined;
const contract = buildContractDetail();
const list = buildEFinanceInvoiceList();

const entry: PreviewEntry = {
  id: "s07f-efinance-invoices",
  title: "S07f Τιμολόγια eFinance",
  states: {
    default: () => <EFinanceInvoices contract={contract} list={list} state="default" noPermission={noPermission} onSelect={noop} />,
    loading: () => <EFinanceInvoices contract={contract} state="loading" noPermission={noPermission} onSelect={noop} />,
    empty: () => (
      <EFinanceInvoices
        contract={contract}
        list={{ configured: true, items: [], total: 0 }}
        state="empty"
        noPermission={noPermission}
        onSelect={noop}
      />
    ),
    error: () => <EFinanceInvoices contract={contract} state="error" noPermission={noPermission} onSelect={noop} onRetry={noop} />,
    noPermission: () => <EFinanceInvoices state="noPermission" noPermission={noPermission} onSelect={noop} />,
    offline: () => <EFinanceInvoices contract={contract} list={list} state="offline" noPermission={noPermission} onSelect={noop} />,
  },
  notes:
    "The fixture has one invoice per ledger: booked, in flight, reversed (with its reason in the row) and " +
    "rejected (no figures). Under 1024px the table gives way to cards, as on S08. «Γραμμές» opens the lines " +
    "sheet. The empty state reads differently when the API answers `configured: false`. Read only — no write.",
};

export default entry;
