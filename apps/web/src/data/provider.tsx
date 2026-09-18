"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// ADR-0005: wraps the tree so usePortfolio/useOrgUnits/useProjects
// (queries.ts) have a QueryClient. layout.tsx must render this around
// {children} — not done here, that file belongs to another agent.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
