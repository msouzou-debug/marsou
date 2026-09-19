// S12 — R20, R21

import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { IcraWizardScreen } from "@/screens/s12-icra/IcraWizardScreen";

export default async function IcraWizardPage({ params }: PageProps<"/permits/[id]/icra">) {
  const { id } = await params;
  return (
    <>
      <IcraWizardScreen permitId={id} noPermission={<NoPermission />} />
      <HelpSection route="/permits/[id]/icra" />
    </>
  );
}
