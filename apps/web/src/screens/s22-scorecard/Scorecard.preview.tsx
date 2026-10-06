// S22 — R37

import { NoPermission } from "@/components/app-shell";
import { buildMaintenanceContract, buildScorecard } from "@/mocks/maintenance";
import type { PreviewEntry } from "@/preview/types";
import { quarter } from "./period";
import { Scorecard, type ScorecardProps } from "./Scorecard";

const base: ScorecardProps = {
  agreements: [buildMaintenanceContract()],
  agreementId: "mc-1",
  onAgreement: () => undefined,
  period: quarter("2026-10-06", -1),
  onPeriod: () => undefined,
  today: "2026-10-06",
  scorecard: buildScorecard(),
  state: "default",
  onRetry: () => undefined,
  onExport: () => undefined,
  noPermission: <NoPermission />,
};

const entry: PreviewEntry = {
  id: "s22-scorecard",
  title: "S22 Αξιολόγηση αναδόχων",
  states: {
    default: () => <Scorecard {...base} />,
    loading: () => <Scorecard {...base} scorecard={undefined} state="loading" />,
    empty: () => <Scorecard {...base} agreementId="" scorecard={undefined} state="idle" />,
    error: () => <Scorecard {...base} scorecard={undefined} state="error" />,
    noPermission: () => <Scorecard {...base} state="noPermission" />,
    offline: () => <Scorecard {...base} state="offline" />,
  },
  notes: "The fixture has `ratesMissing: true`, as the Nicosia seed does today: the penalties tile says «ρήτρες ελλιπείς» and the note explains it. «empty» is no agreement picked yet.",
};

export default entry;
