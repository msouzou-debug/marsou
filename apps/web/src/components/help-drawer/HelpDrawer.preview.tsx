import type { PreviewEntry } from "@/preview/types";
import { HelpDrawer } from "./HelpDrawer";

const entry: PreviewEntry = {
  id: "help-drawer",
  title: "HelpDrawer",
  states: {
    default: () => (
      <div className="relative h-[480px] overflow-hidden rounded-k border border-k-grey">
        <HelpDrawer open onClose={() => {}} role="Μηχανικός έργου" pdfHref="/help/pdf" helpCentreHref="/help">
          <p>Αυτή η οθόνη δείχνει τον προϋπολογισμό, τις δεσμεύσεις και τις δαπάνες όλων των έργων.</p>
          <h3 className="mt-s-4">Βήματα</h3>
          <ol className="list-decimal pl-s-5">
            <li>Επιλέξτε μονάδα από τον πίνακα για να δείτε τα έργα της.</li>
            <li>Ανοίξτε την ενότητα «Χρειάζονται προσοχή» για τις εξαιρέσεις.</li>
          </ol>
          <h3 className="mt-s-4">Τι μπορεί να πάει λάθος</h3>
          <p>Αν τα στοιχεία δεν φορτώνουν, ελέγξτε τη σύνδεση και δοκιμάστε ξανά.</p>
        </HelpDrawer>
      </div>
    ),
    empty: () => (
      <div className="relative h-[480px] overflow-hidden rounded-k border border-k-grey">
        <HelpDrawer open onClose={() => {}} role="Μηχανικός έργου" pdfHref="/help/pdf" helpCentreHref="/help" />
      </div>
    ),
  },
  notes: "Esc closes; on desktop the scrim behind the drawer does not block clicks on the page underneath.",
};

export default entry;
