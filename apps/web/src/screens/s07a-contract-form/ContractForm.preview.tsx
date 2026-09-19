// S07a — R08

import type { Contractor } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { ContractForm } from "./ContractForm";

const contractors: Contractor[] = [
  {
    id: "contractor-1",
    name: "Κυριάκου Τεχνικές Κατασκευές Λτδ",
    vatNumber: "CY10231455X",
    registrationNo: "HE 118422",
    category: "BUILDING",
    sapVendorId: "V-100101",
    blacklisted: false,
  },
  {
    id: "contractor-2",
    name: "Λευκαρίτης Γενικές Εργολαβίες Λτδ",
    vatNumber: "CY10348275W",
    registrationNo: "HE 176184",
    category: "OTHER",
    sapVendorId: "V-100112",
    blacklisted: true,
  },
];

const noop = () => undefined;

const entry: PreviewEntry = {
  id: "s07a-contract-form",
  title: "S07a Νέα σύμβαση",
  states: {
    default: () => <ContractForm mode="create" contractors={contractors} submitting={false} onSubmit={noop} onCancel={noop} />,
    submitting: () => <ContractForm mode="create" contractors={contractors} submitting onSubmit={noop} onCancel={noop} />,
    error: () => (
      <ContractForm
        mode="create"
        contractors={contractors}
        submitting={false}
        apiError="Ο ανάδοχος Λευκαρίτης Γενικές Εργολαβίες Λτδ είναι αποκλεισμένος και δεν αναλαμβάνει νέα σύμβαση."
        onSubmit={noop}
        onCancel={noop}
      />
    ),
  },
  notes:
    "The create form; the second contractor is blacklisted and disabled in the select, with the reason " +
    "as its option title. The edit form (`/contracts/[id]/edit`) is the same component with mode=\"edit\", " +
    "which drops the Ανάδοχος select and the Αρχική αξία input for two read-only facts instead — not " +
    "previewed separately since nothing else differs. No empty/noPermission/offline, same reasoning as S02a.",
};

export default entry;
