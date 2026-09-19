import type { PreviewEntry } from "@/preview/types";
import { CalendarGrid } from "./CalendarGrid";

const ENTRIES = [
  {
    permitId: "p1",
    permitRef: "PTW-NIC-2026-014",
    orgUnitId: "unit-1",
    orgUnitCode: "NIC",
    titleEl: "Διακοπή ρεύματος Α πτέρυγα",
    systems: ["ELECTRICAL" as const],
    areaIds: ["a1"],
    areaTypes: ["THEATRE" as const],
    areaNamesEl: ["Χειρουργείο 1"],
    start: "2026-03-14T08:00:00.000Z",
    end: "2026-03-14T16:00:00.000Z",
    icraClass: "IV" as const,
    status: "APPROVED" as const,
    hasClash: true,
  },
  {
    permitId: "p2",
    permitRef: "PTW-NIC-2026-015",
    orgUnitId: "unit-1",
    orgUnitCode: "NIC",
    titleEl: "Διακοπή νερού Β πτέρυγα",
    systems: ["WATER" as const],
    areaIds: ["a2"],
    areaTypes: ["THEATRE" as const],
    areaNamesEl: ["Χειρουργείο 2"],
    start: "2026-03-14T10:00:00.000Z",
    end: "2026-03-14T18:00:00.000Z",
    icraClass: "III" as const,
    status: "ACTIVE" as const,
    hasClash: true,
  },
];

const entry: PreviewEntry = {
  id: "calendar-grid",
  title: "CalendarGrid",
  states: {
    default: () => <CalendarGrid year={2026} month={2} entries={ENTRIES} onOpen={() => undefined} />,
    empty: () => <CalendarGrid year={2026} month={2} entries={[]} onOpen={() => undefined} />,
  },
  notes:
    "State: default and empty only — the grid renders whatever range the S15 screen already " +
    "fetched; loading/error/noPermission/offline belong to that screen. A clash (RULE, CAPEX-01 " +
    "§6.7) only adds a warning icon and a tooltip naming the other permit; it never blocks opening " +
    "either one.",
};

export default entry;
