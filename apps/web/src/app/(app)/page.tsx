// S01 — R03

import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { PortfolioScreen } from "@/screens/s01-portfolio/PortfolioScreen";

// Server Component: the only job here is to resolve `NoPermission` (an async
// Server Component) once and hand the element to `PortfolioScreen` (a Client
// Component) as a prop, since a Client Component cannot render a Server
// Component itself — see PortfolioScreen's header comment.
export default function Home() {
  return (
    <>
      <PortfolioScreen noPermission={<NoPermission />} />
      <HelpSection route="/" />
    </>
  );
}
