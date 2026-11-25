import type { PreviewEntry } from "@/preview/types";
import { VatFieldsDemo } from "./VatFieldsDemo";

const entry: PreviewEntry = {
  id: "vat-fields",
  title: "VatFields",
  states: { default: () => <VatFieldsDemo /> },
  notes:
    "State: default only — the select, the live summary and the table figure show values their " +
    "parent holds (ADR-0038). Nothing loads, so there is no loading, empty, error, no-permission " +
    "or offline state. Type a net and change the rate: «Ποσό ΦΠΑ» and «Σύνολο με ΦΠΑ» follow.",
};

export default entry;
