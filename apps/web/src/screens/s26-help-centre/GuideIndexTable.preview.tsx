// S26 «Οδηγός χρήσης» — R50

import type { PreviewEntry } from "@/preview/types";
import type { GuideEntry } from "@/help/load-guides-index";
import { GuideIndexTable } from "./GuideIndexTable";

const guides: GuideEntry[] = [
  {
    persona: "estates_head",
    lang: "el",
    file: "estates_head.el.pdf",
    personaLabel: "Προϊστάμενος Τεχνικών Υπηρεσιών",
    sections: 25,
    sizeBytes: 337_100,
    pages: 29,
    sha256: "a".repeat(64),
  },
  {
    persona: "estates_head",
    lang: "en",
    file: "estates_head.en.pdf",
    personaLabel: "Head of estates",
    sections: 25,
    sizeBytes: 309_497,
    pages: 28,
    sha256: "b".repeat(64),
  },
  {
    persona: "technician",
    lang: "el",
    file: "technician.el.pdf",
    personaLabel: "Τεχνίτης",
    sections: 5,
    sizeBytes: 236_635,
    pages: 7,
    sha256: "c".repeat(64),
  },
];

const entry: PreviewEntry = {
  id: "s26-help-centre",
  title: "S26 Οδηγός χρήσης",
  states: {
    default: () => <GuideIndexTable guides={guides} generatedAt="2026-03-14T00:00:00Z" />,
    empty: () => <GuideIndexTable guides={[]} generatedAt="" />,
  },
  notes:
    "Only default and empty apply: the table reads a build artefact (index.json, written by " +
    "scripts/build-guides.mjs) off disk once, server-side — there is no loading spinner, no retry, " +
    "no permission gate (every persona reads the help centre) and no offline behaviour to show, " +
    "since it is not a live data fetch.",
};

export default entry;
