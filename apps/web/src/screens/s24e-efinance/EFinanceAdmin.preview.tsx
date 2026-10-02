// S24e — ADR-0029

import { buildEFinanceMasterSyncResult, buildEFinanceSyncResult } from "@/mocks/efinance";
import type { PreviewEntry } from "@/preview/types";
import { EFinanceAdmin } from "./EFinanceAdmin";

const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s24e-efinance",
  title: "S24e eFinance",
  states: {
    default: () => (
      <EFinanceAdmin
        onSync={noop}
        onSyncMaster={noop}
        syncResult={buildEFinanceSyncResult()}
        masterResult={buildEFinanceMasterSyncResult()}
      />
    ),
    loading: () => <EFinanceAdmin onSync={noop} onSyncMaster={noop} syncing />,
    error: () => (
      <EFinanceAdmin
        onSync={noop}
        onSyncMaster={noop}
        syncResult={buildEFinanceSyncResult({ invoices: { rows: 0, cursor: null, error: "TIMEOUT: δεν υπήρξε απάντηση" } })}
        masterError="Το eFinance δεν απάντησε όπως αναμενόταν (TIMEOUT). Δοκιμάστε ξανά σε λίγο."
      />
    ),
    offline: () => <EFinanceAdmin onSync={noop} onSyncMaster={noop} offline />,
  },
  notes:
    "A card, not a list: nothing to load on arrival, so no empty state (the no-run-yet line is its resting state). " +
    "`loading` is a run in flight (spinner in the button); `error` shows a feed error and a failed call. " +
    "The page itself is admin-only, so no-permission is the page's NoPermission, not this component's. " +
    "A `configured: false` answer renders «Το eFinance δεν έχει ρυθμιστεί σε αυτό το περιβάλλον».",
};

export default entry;
