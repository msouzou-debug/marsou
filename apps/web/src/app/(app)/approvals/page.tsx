// S14 — R22

import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ApprovalsScreen } from "@/screens/s14-approvals/ApprovalsScreen";

export default async function ApprovalsPage() {
  return (
    <>
      <ApprovalsScreen noPermission={<NoPermission />} />
      <HelpSection route="/approvals" />
    </>
  );
}
