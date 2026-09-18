import type { ReactNode } from "react";
import { HelpProvider } from "@/help/HelpProvider";

// The `bare` group: routes that render without the app chrome. Today that is
// S00 alone. It exists as a layout rather than a check inside `AppShell`
// because the App Router already has an idiom for "this branch of the tree
// has different chrome", and a shell that inspected the current path would
// have to become a Client Component to do it.
//
// The help drawer still mounts: S00 has a manual section like every other
// screen (R48), reachable with "?" — there is no top bar to put the Βοήθεια
// button in.
export default function BareLayout({ children }: { children: ReactNode }) {
  return (
    <HelpProvider>
      <div className="flex min-h-screen flex-col bg-k-surface">{children}</div>
    </HelpProvider>
  );
}
