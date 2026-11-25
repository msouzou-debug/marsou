"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SessionExpiredDialog } from "@/components/session-expired";
import { ApiError } from "./client";
import { setErrorTexts } from "./session-expiry";

/** A 401 will not get better by asking again; anything else gets the default three tries. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return false;
  return failureCount < 3;
}

// ADR-0005: wraps the tree so usePortfolio/useOrgUnits/useProjects
// (queries.ts) have a QueryClient. layout.tsx renders this around {children}.
//
// OWNER UAT 25/11/2026: it also hands `data/client.ts` the error sentences in
// the language the app is showing, and mounts the one dialog that says the
// session has ended (`SessionExpiredDialog`), for every query and every save.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("states.error");
  // Idempotent: a module-level setting, refreshed on every render so a
  // language switch carries through.
  setErrorTexts({ sessionExpired: t("sessionExpired"), generic: t("generic"), unreachable: t("unreachable") });
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <SessionExpiredDialog />
    </QueryClientProvider>
  );
}
