"use client";

// The client sliver of the server -> client handoff described in
// `HelpProvider.tsx`: takes the section a Server Component already rendered
// (`children`) and pushes it into `HelpProvider`'s context on mount, so the
// drawer — which lives above the page in the layout — can show it.
import { useEffect, type ReactNode } from "react";
import { useHelp } from "./HelpProvider";

export interface RegisterHelpSectionProps {
  children: ReactNode;
  personas: string[];
}

export function RegisterHelpSection({ children, personas }: RegisterHelpSectionProps) {
  const { registerSection } = useHelp();

  useEffect(() => {
    return registerSection(children, personas);
    // `children` and `personas` are freshly created on every render of the
    // server parent (a new element tree / array each time), which is
    // exactly what should re-register — there is no stable identity to
    // memoize against here. `registerSection` itself is stable (HelpProvider
    // creates it with `useCallback` and an empty dependency list).
  }, [children, personas, registerSection]);

  return null;
}
