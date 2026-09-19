import { describe, expect, it } from "vitest";
import { renderWithIntl } from "@/test/render";
import type { ShutdownPermit } from "@ecapital/shared";
import { PermitPrint } from "./PermitPrint";

const PERMIT: ShutdownPermit = {
  id: "p1",
  ref: "PTW-NIC-2026-001",
  orgUnitId: "unit-1",
  projectId: null,
  contractId: null,
  titleEl: "Διακοπή ρεύματος",
  descriptionEl: "",
  workKind: "MAINTENANCE",
  systems: ["ELECTRICAL"],
  affectedAreas: [],
  plannedStart: "2026-03-14T08:00:00.000Z",
  plannedEnd: "2026-03-14T16:00:00.000Z",
  actualStart: null,
  actualEnd: null,
  icra: {
    matrixVersionId: "OKYPY-ICRA-2.0-2026.1",
    activityType: "C",
    riskGroup: "HIGH",
    riskGroupFromAreaId: "a1",
    icraClass: "IV",
    controls: [{ id: "IV-01", textEl: "Ελέγξτε τα φίλτρα", textEn: "Check filters", phase: "DURING" }],
    permitRequired: true,
    refusalKey: null,
  },
  surrounding: [],
  ilsm: null,
  contingencyPlanEl: null,
  status: "APPROVED",
  approvals: [
    { id: "ap1", permitId: "p1", role: "TECHNICAL", reason: "always", areaId: null, areaNameEl: null, approverId: "u1", approverName: "Ν. Νικολάου", decision: "APPROVED", commentEl: null, decidedAt: "2026-03-12T09:00:00.000Z", dueAt: "2026-03-14T09:00:00.000Z", slaState: "GREEN" },
  ],
  closeout: null,
  requestedById: "req1",
  requestedByName: "Γ. Γεωργίου",
  requestedAt: "2026-03-10T08:00:00.000Z",
  submittedAt: "2026-03-10T09:00:00.000Z",
  approvedAt: "2026-03-11T08:00:00.000Z",
  closedById: null,
  closedAt: null,
  breachedAt: null,
  clashes: [],
  createdAt: "2026-03-10T08:00:00.000Z",
  updatedAt: "2026-03-11T08:00:00.000Z",
};

describe("PermitPrint", () => {
  it("renders one QR code and the permit reference", () => {
    const { container } = renderWithIntl(
      <PermitPrint permit={PERMIT} state="default" recordUrl="https://ecapital.example/permits/p1" noPermission={<div />} />,
    );
    expect(container.querySelectorAll("svg[role='img']")).toHaveLength(1);
    expect(container.textContent).toContain("PTW-NIC-2026-001");
  });

  it("uses --k-purple in exactly one place — the IcraBadge — and nowhere else on the sheet", () => {
    const { container } = renderWithIntl(
      <PermitPrint permit={PERMIT} state="default" recordUrl="https://ecapital.example/permits/p1" noPermission={<div />} />,
    );
    const purpleUsers = Array.from(container.querySelectorAll("[class*='k-purple']"));
    expect(purpleUsers).toHaveLength(1);
    expect(purpleUsers[0]?.textContent).toBe("IV"); // the badge's own class letter
  });
});
