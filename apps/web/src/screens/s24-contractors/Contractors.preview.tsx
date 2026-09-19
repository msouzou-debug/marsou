// S24 — R08

import { NoPermission } from "@/components/app-shell";
import type { Contractor } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { Contractors } from "./Contractors";

const noPermission = <NoPermission />;

const data: Contractor[] = [
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
  id: "s24-contractors",
  title: "S24 Ανάδοχοι",
  states: {
    default: () => <Contractors data={data} state="default" noPermission={noPermission} isAdmin onSelect={noop} onSave={noop} />,
    loading: () => <Contractors state="loading" noPermission={noPermission} onSelect={noop} onSave={noop} />,
    empty: () => <Contractors data={[]} state="empty" noPermission={noPermission} onSelect={noop} onSave={noop} />,
    error: () => <Contractors state="error" noPermission={noPermission} onSelect={noop} onSave={noop} onRetry={noop} />,
    noPermission: () => <Contractors state="noPermission" noPermission={noPermission} onSelect={noop} onSave={noop} />,
  },
  notes:
    "The blacklisted row carries the red «Αποκλεισμένος» chip with an icon. `isAdmin` gates the " +
    "«Αποκλεισμός» toggle in the edit sheet — hidden entirely for estates_head, per ADR-0015's " +
    "19/09/2026 decision. The page itself (`/admin/contractors`) is gated to admin/estates_head before " +
    "this component ever renders — see `canManageContractors` in `@/auth/roles`.",
};

export default entry;
