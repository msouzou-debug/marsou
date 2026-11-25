import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import type { AppRole, ShutdownPermit } from "@ecapital/shared";
import { PermitDetail } from "./PermitDetail";

const BASE_PERMIT: ShutdownPermit = {
  id: "p1",
  ref: "PTW-NIC-2026-001",
  orgUnitId: "unit-1",
  projectId: null,
  contractId: null,
  titleEl: "Διακοπή ρεύματος Α πτέρυγα",
  descriptionEl: "",
  workKind: "MAINTENANCE",
  systems: ["ELECTRICAL"],
  affectedAreas: [
    { areaId: "a1", code: "A101", nameEl: "Χειρουργείο 1", areaType: "THEATRE", patientRiskGroup: "HIGH", buildingCode: "A", floorCode: "1", impact: "DIRECT", viaSystem: null },
  ],
  plannedStart: "2026-03-14T08:00:00.000Z",
  plannedEnd: "2026-03-14T16:00:00.000Z",
  actualStart: null,
  actualEnd: null,
  icra: null,
  surrounding: [],
  ilsm: null,
  contingencyPlanEl: null,
  status: "APPROVED",
  approvals: [
    {
      id: "ap1",
      permitId: "p1",
      role: "TECHNICAL",
      reason: "always",
      areaId: null,
      areaNameEl: null,
      approverId: "me",
      approverName: "Ν. Νικολάου",
      decision: "PENDING",
      commentEl: null,
      decidedAt: null,
      dueAt: "2026-03-16T08:00:00.000Z",
      slaState: "GREEN",
    },
    {
      id: "ap2",
      permitId: "p1",
      role: "SAFETY",
      reason: "ilsmRequired",
      areaId: null,
      areaNameEl: null,
      approverId: "someone-else",
      approverName: "Α. Αντωνίου",
      decision: "PENDING",
      commentEl: null,
      decidedAt: null,
      dueAt: "2026-03-16T08:00:00.000Z",
      slaState: "GREEN",
    },
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

const NOOP_PROPS = {
  roles: ["project_engineer"] as AppRole[],
  myUserId: "me",
  orgUnits: [],
  noPermission: <div />,
  onStartWork: vi.fn(),
  closeoutOpen: false,
  closeoutValue: {
    barriersRemoved: false,
    areaCleaned: false,
    airBalanceRestored: false,
    systemsTestedAndReturned: false,
    fireSystemsReenabled: false,
    noteEl: null,
    clinicalAcceptanceById: null,
    clinicalAcceptanceByName: null,
    clinicalAcceptanceAt: null,
  },
  closeoutSaving: false,
  onOpenCloseout: vi.fn(),
  onChangeCloseout: vi.fn(),
  onSubmitCloseout: vi.fn(),
  onCancelCloseout: vi.fn(),
  rejectOpen: false,
  rejectComment: "",
  rejectSaving: false,
  onOpenReject: vi.fn(),
  onChangeRejectComment: vi.fn(),
  onSubmitReject: vi.fn(),
  onCancelReject: vi.fn(),
  onDecide: vi.fn(),
};

describe("PermitDetail", () => {
  it("shows decide buttons only on the caller's own pending approval line", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        permit={{ ...BASE_PERMIT, status: "CLINICAL_REVIEW" }}
        state="default"
        now={new Date("2026-03-14T09:00:00.000Z")}
      />,
    );
    // One "Έγκριση" for the caller's own TECHNICAL line, none for SAFETY (someone-else's).
    expect(screen.getAllByRole("button", { name: "Έγκριση" })).toHaveLength(1);
  });

  it("disables «Έναρξη εργασιών» outside the planned window, with the reason as a tooltip", () => {
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} permit={BASE_PERMIT} state="default" now={new Date("2026-03-14T20:00:00.000Z")} />,
    );
    const button = screen.getByRole("button", { name: "Έναρξη εργασιών" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title");
  });

  it("enables «Έναρξη εργασιών» inside the planned window on an APPROVED permit", () => {
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} permit={BASE_PERMIT} state="default" now={new Date("2026-03-14T09:00:00.000Z")} />,
    );
    expect(screen.getByRole("button", { name: "Έναρξη εργασιών" })).not.toBeDisabled();
  });

  it("hides the decide buttons on the requester's own line and shows the segregation sentence instead", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        permit={{ ...BASE_PERMIT, status: "CLINICAL_REVIEW", requestedById: "me" }}
        state="default"
        now={new Date("2026-03-14T09:00:00.000Z")}
      />,
    );
    expect(screen.queryByRole("button", { name: "Έγκριση" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Δεν εγκρίνετε άδεια που ζητήσατε εσείς. Αναθέστε την έγκριση σε άλλο πρόσωπο."),
    ).toBeInTheDocument();
  });

  it("shows no PermitBanner for a CLOSED permit, only a closed summary line", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        permit={{ ...BASE_PERMIT, status: "CLOSED", closedAt: "2026-03-15T10:00:00.000Z" }}
        state="default"
      />,
    );
    expect(screen.queryByText("Σε ισχύ")).not.toBeInTheDocument();
    expect(screen.queryByText("Εκκρεμεί έγκριση")).not.toBeInTheDocument();
  });

  // ------------------------------------------------ OWNER UAT 25/11/2026 --

  const RETURNED_DRAFT: ShutdownPermit = {
    ...BASE_PERMIT,
    status: "DRAFT",
    requestedById: "me",
    approvals: [
      { ...BASE_PERMIT.approvals[0], approverId: "estates", decision: "RETURNED", commentEl: "Αλλάξτε το παράθυρο." },
      { ...BASE_PERMIT.approvals[1] },
    ],
  };

  it("offers «Επεξεργασία» on a returned draft, with who returned it and the comment", () => {
    renderWithIntl(<PermitDetail {...NOOP_PROPS} permit={RETURNED_DRAFT} state="default" />);
    expect(screen.getByRole("link", { name: "Επεξεργασία" })).toHaveAttribute("href", "/permits/p1/edit");
    expect(screen.getByText("Ο/Η Ν. Νικολάου επέστρεψε την αίτηση με σχόλια")).toBeInTheDocument();
    expect(screen.getByText("«Αλλάξτε το παράθυρο.»")).toBeInTheDocument();
    // The reset lines of a returned draft wait for the resubmission, not for anybody.
    expect(screen.queryByRole("button", { name: "Έγκριση" })).not.toBeInTheDocument();
  });

  it("offers no decision on a permit that is not in review", () => {
    renderWithIntl(<PermitDetail {...NOOP_PROPS} permit={BASE_PERMIT} state="default" />);
    expect(screen.queryByRole("button", { name: "Έγκριση" })).not.toBeInTheDocument();
  });

  it("offers no edit on an approved permit and says a change is a new request", () => {
    renderWithIntl(<PermitDetail {...NOOP_PROPS} permit={BASE_PERMIT} state="default" />);
    expect(screen.queryByRole("link", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Η άδεια έχει εγκριθεί και δεν αλλάζει πια. Για οποιαδήποτε αλλαγή υποβάλετε νέα αίτηση."),
    ).toBeInTheDocument();
  });

  it("offers no edit to a role that does not raise permits", () => {
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} roles={["clinical_approver"]} permit={RETURNED_DRAFT} state="default" />,
    );
    expect(screen.queryByRole("link", { name: "Επεξεργασία" })).not.toBeInTheDocument();
  });

  it("says a line has nobody appointed, and lets an administrator decide it", () => {
    const unassigned: ShutdownPermit = {
      ...BASE_PERMIT,
      status: "CLINICAL_REVIEW",
      approvals: [{ ...BASE_PERMIT.approvals[1], approverId: null, approverName: null }],
    };
    renderWithIntl(<PermitDetail {...NOOP_PROPS} permit={unassigned} state="default" />);
    expect(screen.getByText(/Δεν έχει οριστεί εγκρίνων/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Έγκριση" })).not.toBeInTheDocument();

    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} roles={["admin"]} myUserId="admin" permit={unassigned} state="default" />,
    );
    expect(screen.getByRole("button", { name: "Έγκριση" })).toBeInTheDocument();
  });

  it("shows the API's sentence under the line whose decision was refused", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        permit={{ ...BASE_PERMIT, status: "CLINICAL_REVIEW" }}
        state="default"
        decideError={{ approvalId: "ap1", message: "Η γραμμή έγκρισης περιμένει άλλο πρόσωπο." }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Η γραμμή έγκρισης περιμένει άλλο πρόσωπο.");
  });
});
