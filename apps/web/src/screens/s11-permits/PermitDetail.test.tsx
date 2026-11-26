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
  handback: {
    submittedAt: null,
    submittedById: null,
    submittedByName: null,
    returnedAt: null,
    returnedById: null,
    returnedByName: null,
    returnCommentEl: null,
    mayAccept: false,
  },
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
  acceptOpen: false,
  acceptSaving: false,
  onOpenAccept: vi.fn(),
  onSubmitAccept: vi.fn(),
  onCancelAccept: vi.fn(),
  giveBackOpen: false,
  giveBackComment: "",
  giveBackSaving: false,
  onOpenGiveBack: vi.fn(),
  onChangeGiveBackComment: vi.fn(),
  onSubmitGiveBack: vi.fn(),
  onCancelGiveBack: vi.fn(),
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

  // OWNER UAT 25/11/2026: «Start work does not work for admin» — the button
  // was disabled with its reason only in a tooltip.
  it("says, under the disabled button, that the window has not started yet, with its dates", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        roles={["admin"]}
        permit={BASE_PERMIT}
        state="default"
        now={new Date("2026-03-14T07:00:00.000Z")}
      />,
    );
    const button = screen.getByRole("button", { name: "Έναρξη εργασιών" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      /^Το παράθυρο εργασιών ξεκινά στις 14\/03\/2026\s10:00 και λήγει στις 14\/03\/2026\s18:00\. Η έναρξη εργασιών γίνεται μόνο μέσα σε αυτό\.$/,
    );
    expect(screen.getByText(/ξεκινά στις 14\/03\/2026 10:00/)).toBeVisible();
  });

  it("says when the window ended once it has passed", () => {
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} permit={BASE_PERMIT} state="default" now={new Date("2026-03-14T20:00:00.000Z")} />,
    );
    expect(screen.getByRole("button", { name: "Έναρξη εργασιών" })).toBeDisabled();
    expect(screen.getByText(/έληξε στις 14\/03\/2026 18:00/)).toBeVisible();
  });

  it("enables «Έναρξη εργασιών» for an administrator inside the window, with no reason line", () => {
    const onStartWork = vi.fn();
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        roles={["admin"]}
        onStartWork={onStartWork}
        permit={BASE_PERMIT}
        state="default"
        now={new Date("2026-03-14T09:00:00.000Z")}
      />,
    );
    const button = screen.getByRole("button", { name: "Έναρξη εργασιών" });
    expect(button).not.toBeDisabled();
    button.click();
    expect(onStartWork).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/παράθυρο εργασιών/)).toBeNull();
  });

  it("shows the API's refusal sentence when starting fails", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        permit={BASE_PERMIT}
        state="default"
        now={new Date("2026-03-14T09:00:00.000Z")}
        startWorkError="Η άδεια εργασίας ισχύει μόνο μέσα στην περίοδο για την οποία εγκρίθηκε."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Η άδεια εργασίας ισχύει μόνο μέσα στην περίοδο");
  });

  it("offers no «Έναρξη εργασιών» on a permit that has already started", () => {
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} permit={{ ...BASE_PERMIT, status: "ACTIVE" }} state="default" now={new Date("2026-03-14T09:00:00.000Z")} />,
    );
    expect(screen.queryByRole("button", { name: "Έναρξη εργασιών" })).toBeNull();
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

  // ------------------------------- OWNER 26/11/2026, handback in two steps --

  const FULL_BOXES = {
    ...NOOP_PROPS.closeoutValue,
    barriersRemoved: true,
    areaCleaned: true,
    airBalanceRestored: true,
    systemsTestedAndReturned: true,
    fireSystemsReenabled: true,
    noteEl: "Ο χώρος παραδόθηκε καθαρός.",
  };
  const RUNNING: ShutdownPermit = { ...BASE_PERMIT, status: "ACTIVE", actualStart: "2026-03-14T08:30:00.000Z" };
  const WAITING: ShutdownPermit = {
    ...RUNNING,
    actualEnd: "2026-03-14T15:00:00.000Z",
    closeout: FULL_BOXES,
    handback: {
      ...BASE_PERMIT.handback,
      submittedAt: "2026-03-14T15:00:00.000Z",
      submittedById: "eng",
      submittedByName: "Α. Παπαδόπουλος",
    },
  };
  const NOW = new Date("2026-03-14T15:30:00.000Z");

  it("offers the works side «Ολοκλήρωση εργασιών» on a running permit, and no acceptance", () => {
    const onOpenCloseout = vi.fn();
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} onOpenCloseout={onOpenCloseout} permit={RUNNING} state="default" now={NOW} />,
    );
    screen.getByRole("button", { name: "Ολοκλήρωση εργασιών" }).click();
    expect(onOpenCloseout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Αποδοχή και κλείσιμο" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Κλείσιμο" })).toBeNull();
  });

  it("offers a clinical approver nothing on a running permit before the works side submits", () => {
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} roles={["clinical_approver"]} permit={RUNNING} state="default" now={NOW} />,
    );
    expect(screen.queryByRole("button", { name: "Ολοκλήρωση εργασιών" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Αποδοχή και κλείσιμο" })).toBeNull();
  });

  it("asks for every box before «Υποβολή για αποδοχή», and has no acceptance box", () => {
    const { unmount } = renderWithIntl(
      <PermitDetail {...NOOP_PROPS} closeoutOpen permit={RUNNING} state="default" now={NOW} />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Υποβολή για αποδοχή" })).toBeDisabled();
    unmount();
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} closeoutOpen closeoutValue={FULL_BOXES} permit={RUNNING} state="default" now={NOW} />,
    );
    expect(screen.getByRole("button", { name: "Υποβολή για αποδοχή" })).not.toBeDisabled();
  });

  it("shows the works side «Αναμονή αποδοχής παράδοσης» once submitted, with nothing to press", () => {
    renderWithIntl(<PermitDetail {...NOOP_PROPS} permit={WAITING} state="default" now={NOW} />);
    expect(screen.getByText("Αναμονή αποδοχής παράδοσης")).toBeInTheDocument();
    expect(screen.getByText(/Ο\/Η Α\. Παπαδόπουλος υπέβαλε τον χώρο για αποδοχή στις 14\/03\/2026 17:00/)).toBeInTheDocument();
    expect(screen.getByText(/περιμένει την αποδοχή του κλινικού υπευθύνου/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ολοκλήρωση εργασιών" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Αποδοχή και κλείσιμο" })).toBeNull();
  });

  it("offers the clinical owner «Αποδοχή και κλείσιμο» and «Επιστροφή με σχόλια» when the API says they may sign", () => {
    const onOpenAccept = vi.fn();
    const onOpenGiveBack = vi.fn();
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        roles={["clinical_approver"]}
        myUserId="clin"
        onOpenAccept={onOpenAccept}
        onOpenGiveBack={onOpenGiveBack}
        permit={{ ...WAITING, handback: { ...WAITING.handback, mayAccept: true } }}
        state="default"
        now={NOW}
      />,
    );
    screen.getByRole("button", { name: "Αποδοχή και κλείσιμο" }).click();
    screen.getByRole("button", { name: "Επιστροφή με σχόλια" }).click();
    expect(onOpenAccept).toHaveBeenCalledTimes(1);
    expect(onOpenGiveBack).toHaveBeenCalledTimes(1);
  });

  it("offers an administrator no acceptance: the API does not let them sign", () => {
    renderWithIntl(
      <PermitDetail {...NOOP_PROPS} roles={["admin"]} myUserId="admin" permit={WAITING} state="default" now={NOW} />,
    );
    expect(screen.queryByRole("button", { name: "Αποδοχή και κλείσιμο" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ολοκλήρωση εργασιών" })).toBeNull();
  });

  it("shows the submitted checklist read-only in the acceptance dialog", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        roles={["clinical_approver"]}
        acceptOpen
        permit={{ ...WAITING, handback: { ...WAITING.handback, mayAccept: true } }}
        state="default"
        now={NOW}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Αποδοχή παράδοσης χώρου" });
    expect(dialog).toHaveTextContent("Υποβλήθηκε από τον/την Α. Παπαδόπουλος");
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
  });

  it("needs a comment before the handback can be returned", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        roles={["clinical_approver"]}
        giveBackOpen
        permit={{ ...WAITING, handback: { ...WAITING.handback, mayAccept: true } }}
        state="default"
        now={NOW}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Επιστροφή παράδοσης με σχόλια" });
    const buttons = dialog.querySelectorAll("button");
    expect(buttons[buttons.length - 1]).toBeDisabled();
  });

  it("says who returned the handback and why, and offers the works side «Ολοκλήρωση εργασιών» again", () => {
    renderWithIntl(
      <PermitDetail
        {...NOOP_PROPS}
        permit={{
          ...RUNNING,
          handback: {
            ...BASE_PERMIT.handback,
            submittedById: "eng",
            submittedByName: "Α. Παπαδόπουλος",
            returnedAt: "2026-03-14T15:20:00.000Z",
            returnedById: "clin",
            returnedByName: "Γ. Σάββα",
            returnCommentEl: "Υπάρχει σκόνη στους αεραγωγούς.",
          },
        }}
        state="default"
        now={NOW}
      />,
    );
    expect(screen.getByText(/Ο\/Η Γ\. Σάββα επέστρεψε την παράδοση του χώρου/)).toBeInTheDocument();
    expect(screen.getByText("«Υπάρχει σκόνη στους αεραγωγούς.»")).toBeInTheDocument();
    expect(screen.getByText("Σε ισχύ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ολοκλήρωση εργασιών" })).toBeInTheDocument();
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
