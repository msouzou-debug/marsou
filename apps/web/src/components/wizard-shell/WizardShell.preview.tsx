import type { PreviewEntry } from "@/preview/types";
import { WizardShell, type WizardStep } from "./WizardShell";

const steps: WizardStep[] = [
  { id: "system", label: "Σύστημα" },
  { id: "areas", label: "Χώροι που επηρεάζονται" },
  { id: "dates", label: "Ημερομηνία και διάρκεια" },
  { id: "review", label: "Επισκόπηση" },
];

const entry: PreviewEntry = {
  id: "wizard-shell",
  title: "WizardShell",
  states: {
    default: () => (
      <WizardShell steps={steps} current={1} canContinue onBack={() => {}} onNext={() => {}}>
        <div>
          <h2 className="text-fs-20">Χώροι που επηρεάζονται</h2>
          <p className="mt-s-3 text-fs-14 text-k-text">
            Επιλέξτε τους χώρους που επηρεάζονται από τη διακοπή.
          </p>
        </div>
      </WizardShell>
    ),
  },
  notes:
    "Only \"default\" applies — this is a layout shell, not a data-holding component; " +
    "loading/empty/error/offline belong to the step content the caller renders.",
};

export default entry;
