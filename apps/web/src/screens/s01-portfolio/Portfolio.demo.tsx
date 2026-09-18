"use client";

// Fixture data and handlers for the preview gallery (ADR-0004), split out as
// its own client module for the same reason Table.demo.tsx is: the gallery
// page composes a Server Component (`Portfolio.preview.tsx`, which resolves
// `NoPermission`) with a Client Component, and a Server Component cannot
// hand event-handler props like `onRetry` across that boundary itself.

import type { ReactNode } from "react";
import type { OrgUnit, PortfolioResponse } from "@ecapital/shared";
import { Portfolio, type PortfolioScreenState } from "./Portfolio";

function unit(id: string, code: string, nameEl: string, nameEn: string, directorate: OrgUnit["directorate"]): OrgUnit {
  return {
    id,
    code,
    nameEl,
    nameEn,
    type: id === "dypsy" || id === "ambulance" ? "SERVICE" : "HOSPITAL",
    directorate,
    costCentre: `CC-${code}-01`,
    timezone: "Europe/Nicosia",
  };
}

function ramp(total: number): number[] {
  return Array.from({ length: 12 }, (_, i) => Math.round((total * (i + 1)) / 12));
}

const units: PortfolioResponse["units"] = [
  {
    orgUnit: unit("nicosia-general", "NGH", "Γενικό Νοσοκομείο Λευκωσίας", "Nicosia General Hospital", "LEFKOSIAS"),
    projectCount: 12,
    approved: 2_000_000,
    spent: 1_300_000,
    sparkline: { plan: ramp(2_000_000), spend: ramp(1_300_000) },
    rag: { green: 8, amber: 3, red: 1 },
  },
  {
    orgUnit: unit("larnaca-general", "LAR", "Γενικό Νοσοκομείο Λάρνακας", "Larnaca General Hospital", "LARNAKAS_AMMOCHOSTOU"),
    projectCount: 8,
    approved: 1_500_000,
    spent: 900_000,
    sparkline: { plan: ramp(1_500_000), spend: ramp(900_000) },
    rag: { green: 5, amber: 2, red: 1 },
  },
  {
    orgUnit: unit("limassol-general", "LMS", "Γενικό Νοσοκομείο Λεμεσού", "Limassol General Hospital", "LEMESOU_PAFOU"),
    projectCount: 6,
    approved: 900_000,
    spent: 700_000,
    sparkline: { plan: ramp(900_000), spend: ramp(700_000) },
    rag: { green: 4, amber: 1, red: 1 },
  },
  {
    orgUnit: unit("dypsy", "DYP", "Διεύθυνση Υπηρεσιών Ψυχικής Υγείας", "Mental Health Services", "DYPSY"),
    projectCount: 3,
    approved: 500_000,
    spent: 480_000,
    sparkline: { plan: ramp(500_000), spend: ramp(480_000) },
    rag: { green: 2, amber: 1, red: 0 },
  },
  {
    orgUnit: unit("ambulance", "AMB", "Υπηρεσία Ασθενοφόρων", "Ambulance Service", "AMBULANCE"),
    projectCount: 2,
    approved: 350_000,
    spent: 90_000,
    sparkline: { plan: ramp(350_000), spend: ramp(90_000) },
    rag: { green: 2, amber: 0, red: 0 },
  },
];

const exceptions: PortfolioResponse["exceptions"] = [
  {
    id: "EXC-1",
    projectId: "P-1001",
    orgUnitId: "nicosia-general",
    sentenceEl:
      "Η πρόβλεψη τελικού κόστους υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά € 210.000 — Ανακαίνιση Μονάδας Εντατικής Θεραπείας, Γενικό Νοσοκομείο Λευκωσίας",
    sentenceEn: "The forecast final cost exceeds the approved budget by € 210,000 — ICU renovation, Nicosia General Hospital",
    severity: "red",
    href: "/projects/P-1001",
  },
  {
    id: "EXC-2",
    projectId: "P-1042",
    orgUnitId: "larnaca-general",
    sentenceEl:
      "Οι δεσμεύσεις υπερβαίνουν τον εγκεκριμένο προϋπολογισμό κατά € 45.000 — Αντικατάσταση στέγης χειρουργείου, Γενικό Νοσοκομείο Λάρνακας",
    sentenceEn: "Commitments exceed the approved budget by € 45,000 — Operating theatre roof replacement, Larnaca General Hospital",
    severity: "amber",
    href: "/projects/P-1042",
  },
];

const fixture: PortfolioResponse = {
  kpis: { approved: 5_250_000, committed: 4_100_000, spent: 3_470_000, forecast: 5_460_000, yearElapsedPct: 62.3 },
  units,
  exceptions,
  asOf: "2026-09-15T09:00:00.000Z",
};

// "empty" is "no projects at all" (every unit's project count is zero), not
// an empty units array — otherwise there would be nothing left to group by
// directorate in the preview.
const emptyFixture: PortfolioResponse = {
  kpis: { approved: 0, committed: 0, spent: 0, forecast: 0, yearElapsedPct: 62.3 },
  units: units.map((u) => ({ ...u, projectCount: 0, approved: 0, spent: 0 })),
  exceptions: [],
  asOf: "2026-09-15T09:00:00.000Z",
};

// Also exercises the never-empty "Χρειάζονται προσοχή" sentence.
const offlineFixture: PortfolioResponse = { ...fixture, exceptions: [] };

export interface PortfolioDemoProps {
  state: PortfolioScreenState;
  noPermission: ReactNode;
}

export function PortfolioDemo({ state, noPermission }: PortfolioDemoProps) {
  const data =
    state === "empty" ? emptyFixture : state === "offline" ? offlineFixture : state === "loading" ? undefined : fixture;
  return (
    <Portfolio
      data={data}
      state={state}
      onRetry={() => undefined}
      onAddProject={() => undefined}
      noPermission={noPermission}
    />
  );
}
