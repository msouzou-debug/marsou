import type { ReactNode } from "react";

// ADR-0004: the component gallery is a dev-only tool, outside the gate (see
// `src/proxy.ts`), so it cannot ask the API who is signed in and cannot
// render the real app shell around itself. Components that need the shell
// show it through their own preview entry (`AppShell.preview.tsx`) instead.
export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
