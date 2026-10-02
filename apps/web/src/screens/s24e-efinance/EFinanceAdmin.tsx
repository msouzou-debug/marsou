"use client";

// S24e — ADR-0029
//
/**
 * EFinanceAdmin — the administrator's eFinance card: two buttons that run the
 * syncs now instead of waiting for the timer, and what each run did.
 *
 * | Prop            | Type                          | Notes                                                            |
 * |-----------------|-------------------------------|-------------------------------------------------------------------|
 * | syncResult      | EFinanceSyncResult?           | The answer of the last «Συγχρονισμός τώρα» run from this page.     |
 * | syncError       | string?                       | An `ApiError` sentence when the call itself failed.                |
 * | syncing         | boolean                       | Run in flight.                                                    |
 * | onSync          | () => void                    | `POST /admin/efinance/sync` — invoices and requisitions.           |
 * | masterResult / masterError / syncingMaster / onSyncMaster | — | The same, for `POST /admin/efinance/sync-master` — entities and vendors. |
 * | offline         | boolean                       | Disables both buttons; a run needs the network.                    |
 *
 * RULE (ADR-0029): the API keeps no run history and exposes no "last sync"
 * route — each call answers with what that run did and when (`ranAt`). So
 * the card shows the last run made from this page, in this session, and says
 * so; it does not pretend to know what the timer did. Per-contract
 * «Στοιχεία eFinance έως» on S07 is the last time one contract's figures were
 * read.
 *
 * RULE: not configured is a state, not an error — the API answers 200 with
 * `configured: false` and did nothing, and the card says exactly that.
 *
 * RULE (UI instructions §4): one filled blue button per view — «Συγχρονισμός
 * τώρα». «Βασικά δεδομένα» is secondary.
 *
 * State: default only; a result area per button. There is nothing to load on
 * arrival, so loading/empty/error of the page itself do not apply.
 */
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import type { EFinanceMasterSyncResult, EFinanceSyncResult } from "@ecapital/shared";
import { formatDateTime, formatInt } from "@/lib/format";

export interface EFinanceAdminProps {
  syncResult?: EFinanceSyncResult;
  syncError?: string;
  syncing?: boolean;
  onSync: () => void;
  masterResult?: EFinanceMasterSyncResult;
  masterError?: string;
  syncingMaster?: boolean;
  onSyncMaster: () => void;
  offline?: boolean;
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-s-3">
      <dt className="text-k-text">{label}</dt>
      <dd className="num text-k-ink" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export function EFinanceAdmin({
  syncResult,
  syncError,
  syncing = false,
  onSync,
  masterResult,
  masterError,
  syncingMaster = false,
  onSyncMaster,
  offline = false,
}: EFinanceAdminProps) {
  const t = useTranslations("screens.s24e");
  const busy = syncing || syncingMaster;

  return (
    <section aria-labelledby="efinance-admin-title" className="grid max-w-[720px] gap-s-4 rounded-k border border-k-grey bg-k-white p-s-5">
      <div>
        <h1 id="efinance-admin-title" className="text-fs-20">
          {t("title")}
        </h1>
        <p className="mt-s-1 text-fs-14 text-k-text">{t("intro")}</p>
      </div>

      <div className="flex flex-wrap gap-s-3">
        <button
          type="button"
          onClick={onSync}
          disabled={busy || offline}
          className="flex min-h-[44px] items-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          {syncing && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {t("syncNow")}
        </button>
        <button
          type="button"
          onClick={onSyncMaster}
          disabled={busy || offline}
          className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
        >
          {syncingMaster && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {t("syncMaster")}
        </button>
      </div>
      {offline && <p className="text-fs-14 text-k-text">{t("offline")}</p>}

      <div className="grid gap-s-4 text-fs-14" aria-live="polite">
        {syncError && (
          <p role="alert" className="text-k-red">
            {syncError}
          </p>
        )}
        {syncResult && (
          <div data-testid="efinance-sync-result" className="grid gap-s-2">
            <h2 className="font-bold text-k-ink">{t("syncResultTitle", { when: formatDateTime(syncResult.ranAt) })}</h2>
            {syncResult.configured ? (
              <>
                <dl className="grid gap-s-1">
                  <Row label={t("invoices")} value={formatInt(syncResult.invoices.rows)} testId="sync-invoices" />
                  <Row label={t("requisitions")} value={formatInt(syncResult.requisitions.rows)} testId="sync-requisitions" />
                  <Row label={t("contractsRefreshed")} value={formatInt(syncResult.contractsRefreshed)} testId="sync-contracts" />
                </dl>
                {syncResult.invoices.error && (
                  <p role="alert" className="text-k-red">
                    {t("feedError", { feed: t("feedInvoices"), detail: syncResult.invoices.error })}
                  </p>
                )}
                {syncResult.requisitions.error && (
                  <p role="alert" className="text-k-red">
                    {t("feedError", { feed: t("feedRequisitions"), detail: syncResult.requisitions.error })}
                  </p>
                )}
              </>
            ) : (
              <p className="text-k-text">{t("notConfigured")}</p>
            )}
          </div>
        )}
        {masterResult && (
          <div data-testid="efinance-master-result" className="grid gap-s-2">
            <h2 className="font-bold text-k-ink">{t("masterResultTitle", { when: formatDateTime(masterResult.ranAt) })}</h2>
            {masterResult.configured ? (
              <>
                <dl className="grid gap-s-1">
                  <Row label={t("unitsMatched")} value={formatInt(masterResult.unitsMatched)} testId="master-units" />
                  <Row label={t("vendorsUpserted")} value={formatInt(masterResult.vendorsUpserted)} testId="master-upserted" />
                  <Row label={t("vendorsDeactivated")} value={formatInt(masterResult.vendorsDeactivated)} testId="master-deactivated" />
                </dl>
                {masterResult.error && (
                  <p role="alert" className="text-k-red">
                    {t("masterError", { detail: masterResult.error })}
                  </p>
                )}
              </>
            ) : (
              <p className="text-k-text">{t("notConfigured")}</p>
            )}
          </div>
        )}
        {masterError && (
          <p role="alert" className="text-k-red">
            {masterError}
          </p>
        )}
        {!syncResult && !masterResult && !syncError && !masterError && <p className="text-k-text">{t("noRunYet")}</p>}
      </div>
    </section>
  );
}
