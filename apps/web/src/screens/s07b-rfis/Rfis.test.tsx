import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nicosiaDateOf, type RfiDocument } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { formatDate } from "@/lib/format";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildRfis } from "./fixture";
import { RfiSheet } from "./RfiSheet";
import { Rfis } from "./Rfis";

const noPermission = <div>no permission</div>;
const contract = buildContractDetail();
const now = new Date("2026-09-19T09:00:00.000Z");

describe("Rfis — R09, ADR-0017", () => {
  it("shows the answered date in mono once an RFI is answered, replacing the SlaChip", () => {
    const rfis = buildRfis(now);
    renderWithIntl(
      <Rfis contract={contract} rfis={rfis} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );

    const closedRow = rfis.find((r) => r.status === "CLOSED")!;
    const closedRowElement = screen.getByText(closedRow.questionEl).closest("tr")!;
    // The answered date, not a chip — RfiSheet is not open so this is the
    // table's own Προθεσμία column.
    expect(closedRowElement.textContent).toContain(formatDate(closedRow.answeredAt!));

    const openRow = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
    const openRowElement = screen.getByText(openRow.questionEl).closest("tr")!;
    // A live chip for the still-open one.
    expect(openRowElement.querySelector("[class*='rounded-k-chip']")).not.toBeNull();
  });

  it("counts open and breached RFIs in the mono summary line", () => {
    renderWithIntl(
      <Rfis contract={contract} rfis={buildRfis(now)} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );
    // 2 OPEN (one breached, one green), 1 CLOSED — 2 open, 1 breached.
    expect(screen.getByText("2 ανοιχτά · 1 εκπρόθεσμα")).toBeInTheDocument();
  });

  it("hides «Προσθήκη» for a role that may read but not write the log (technician)", () => {
    renderWithIntl(
      <Rfis contract={contract} rfis={buildRfis(now)} state="default" noPermission={noPermission} roles={["technician"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });

  it("renders noPermission verbatim", () => {
    renderWithIntl(<Rfis state="noPermission" noPermission={<div>ασχετο</div>} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />);
    expect(screen.getByText("ασχετο")).toBeInTheDocument();
  });
});

describe("Rfis — detail and edit (UAT 25/11/2026)", () => {
  const rfis = buildRfis(now);
  const openRfi = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
  const closedRfi = rfis.find((r) => r.status === "CLOSED")!;

  function renderSelected(selectedId: string | null, props: Partial<Parameters<typeof Rfis>[0]> = {}) {
    return renderWithIntl(
      <Rfis
        contract={contract}
        rfis={rfis}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        selectedId={selectedId}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(true)}
        {...props}
      />,
    );
  }

  it("opens an RFI when its row is clicked, and on Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderSelected(null, { onSelect });
    const row = screen.getByText(openRfi.questionEl).closest("tr")!;
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(openRfi.id);

    onSelect.mockClear();
    act(() => row.focus());
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(openRfi.id);
  });

  it("shows number, question, who raised it and when, due date, status and the answer", () => {
    renderSelected(closedRfi.id);
    const dialog = within(screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${closedRfi.number}` }));
    expect(dialog.getByText(closedRfi.questionEl)).toBeInTheDocument();
    expect(dialog.getByText(closedRfi.answerEl!)).toBeInTheDocument();
    expect(dialog.getByText("Υπέβαλε").nextElementSibling?.textContent).toContain(closedRfi.raisedByName);
    expect(dialog.getByText(formatDate(closedRfi.raisedAt))).toBeInTheDocument();
    expect(dialog.getByText(formatDate(closedRfi.slaDueAt))).toBeInTheDocument();
    expect(dialog.getByText("Έκλεισε")).toBeInTheDocument();
    // A closed RFI is not edited.
    expect(dialog.queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(dialog.getByText("Το αίτημα διευκρίνισης είναι κλειστό και δεν αλλάζει πια.")).toBeInTheDocument();
  });

  it("offers no «Επεξεργασία» to a role that only reads the log", () => {
    renderSelected(openRfi.id, { roles: ["finance"] });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
  });

  it("edits the question and due date, refusing a due date before the day it was raised", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderSelected(openRfi.id, { onUpdate });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Επεξεργασία" }));

    const dialog = within(screen.getByRole("dialog", { name: `Επεξεργασία αιτήματος διευκρίνισης ${openRfi.number}` }));
    const due = dialog.getByLabelText("Προθεσμία");
    expect(due).toHaveValue(nicosiaDateOf(openRfi.slaDueAt));

    const dayBefore = new Date(`${nicosiaDateOf(openRfi.raisedAt)}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    fireEvent.change(due, { target: { value: dayBefore.toISOString().slice(0, 10) } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(await dialog.findByText("Η προθεσμία δεν μπορεί να είναι πριν από την ημερομηνία υποβολής.")).toBeInTheDocument();

    const question = dialog.getByLabelText("Ερώτηση");
    await user.clear(question);
    await user.type(question, "Ποιος τύπος πυράντοχης θύρας ισχύει;");
    fireEvent.change(due, { target: { value: "2026-09-30" } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).toHaveBeenCalledWith({
      questionEl: "Ποιος τύπος πυράντοχης θύρας ισχύει;",
      dueDate: "2026-09-30",
      recipientName: openRfi.recipientName,
      recipientEmail: openRfi.recipientEmail,
      sentOn: "",
    });
    // Saved: back to the read view.
    expect(await screen.findByRole("dialog", { name: `Αίτημα διευκρίνισης ${openRfi.number}` })).toBeInTheDocument();
  });
});

describe("Rfis — recipient, sent day and correspondence (owner decision 25/11/2026)", () => {
  const rfis = buildRfis(now);
  const openRfi = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
  const oldRfi = rfis.find((r) => r.recipientName === null)!;
  const closedRfi = rfis.find((r) => r.status === "CLOSED")!;
  const documents: RfiDocument[] = [
    {
      id: "doc-sent",
      titleEl: "Απεσταλμένο μήνυμα ΑΔ 2",
      filename: "RFI-2.msg",
      mime: "application/vnd.ms-outlook",
      size: 2048,
      protocolNumber: null,
      uploadedByName: "Ελένη Χριστοδούλου",
      createdAt: "2026-09-16T08:00:00.000Z",
    },
    {
      id: "doc-reply",
      titleEl: "Απάντηση αρχιτέκτονα",
      filename: "reply.pdf",
      mime: "application/pdf",
      size: 4096,
      protocolNumber: "ΤΥ/2026/00042",
      uploadedByName: "Ελένη Χριστοδούλου",
      createdAt: "2026-09-18T08:00:00.000Z",
    },
  ];

  function renderRfis(props: Partial<Parameters<typeof Rfis>[0]> = {}) {
    return renderWithIntl(
      <Rfis
        contract={contract}
        rfis={rfis}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(true)}
        {...props}
      />,
    );
  }

  it("shows the recipient and the day it was sent as columns", () => {
    renderRfis();
    const closedRow = screen.getByText(closedRfi.questionEl).closest("tr")!;
    expect(closedRow.textContent).toContain("Δοκιμαστική Εργοληπτική Λτδ");
    expect(closedRow.textContent).toContain("21/08/2026");
    expect(screen.getByRole("columnheader", { name: /Παραλήπτης/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Αποστολή/ })).toBeInTheDocument();
  });

  it("requires the recipient on a new RFI and checks the address", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderRfis({ selectedId: "new", onCreate });
    const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByLabelText("Ερώτηση"), "Ποιο πάχος μόνωσης ισχύει;");
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(await dialog.findByText("Συμπληρώστε αυτό το πεδίο.")).toBeInTheDocument();

    await user.type(dialog.getByLabelText("Παραλήπτης"), "Νίκος Γεωργίου, Μηχανολογικό γραφείο");
    await user.type(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"), "όχι διεύθυνση");
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(await dialog.findByText("Η διεύθυνση ηλεκτρονικού ταχυδρομείου δεν είναι έγκυρη.")).toBeInTheDocument();

    await user.clear(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"));
    await user.type(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"), "n.georgiou@mep.example");
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onCreate).toHaveBeenCalledWith({
      questionEl: "Ποιο πάχος μόνωσης ισχύει;",
      slaDays: 7,
      recipientName: "Νίκος Γεωργίου, Μηχανολογικό γραφείο",
      recipientEmail: "n.georgiou@mep.example",
      sentOn: "",
    });
    // eCapital sends nothing: the form says so.
    expect(dialog.getByText(/Το eCapital δεν στέλνει μηνύματα/)).toBeInTheDocument();
  });

  it("refuses a sent day after today or before the day the RFI was raised", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderWithIntl(
      <RfiSheet
        open
        rfi={openRfi}
        canWrite
        today="2026-09-19"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
        onUpdate={onUpdate}
        documents={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Επεξεργασία" }));
    const dialog = within(screen.getByRole("dialog"));
    const sentOn = dialog.getByLabelText("Ημερομηνία αποστολής");

    fireEvent.change(sentOn, { target: { value: "2026-09-20" } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(await dialog.findByText("Η ημερομηνία δεν μπορεί να είναι μεταγενέστερη της σημερινής.")).toBeInTheDocument();

    const dayBefore = new Date(`${nicosiaDateOf(openRfi.raisedAt)}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    fireEvent.change(sentOn, { target: { value: dayBefore.toISOString().slice(0, 10) } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(
      await dialog.findByText("Η ημερομηνία αποστολής δεν μπορεί να είναι πριν από την ημερομηνία υποβολής."),
    ).toBeInTheDocument();

    fireEvent.change(sentOn, { target: { value: nicosiaDateOf(openRfi.raisedAt) } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ sentOn: nicosiaDateOf(openRfi.raisedAt) }));
  });

  it("lets an RFI from before the recipient existed be corrected without one", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderRfis({ selectedId: oldRfi.id, onUpdate, documents: [] });
    const readView = within(screen.getByRole("dialog"));
    expect(readView.getAllByText("Δεν έχει καταχωριστεί").length).toBeGreaterThanOrEqual(1);
    await user.click(readView.getByRole("button", { name: "Επεξεργασία" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ recipientName: "" }));
  });

  it("lists the correspondence with «Προβολή» and «Λήψη», and files a new one", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn().mockResolvedValue(true);
    renderRfis({ selectedId: openRfi.id, documents, onUpload });
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Αλληλογραφία")).toBeInTheDocument();
    expect(dialog.getByText(/Σε αναμονή πρωτοκόλλου/)).toBeInTheDocument();
    expect(dialog.getByText(/ΤΥ\/2026\/00042/)).toBeInTheDocument();

    // A .msg cannot be shown in a tab, so «Προβολή» saves it; a PDF opens inline.
    const views = dialog.getAllByRole("link", { name: /Προβολή/ });
    expect(views[0]).toHaveAttribute("href", "/api/proxy/documents/doc-sent/content?download=1");
    expect(views[1]).toHaveAttribute("href", "/api/proxy/documents/doc-reply/content");
    const downloads = dialog.getAllByRole("link", { name: /Λήψη/ });
    expect(downloads[1]).toHaveAttribute("href", "/api/proxy/documents/doc-reply/content?download=1");

    await user.click(dialog.getByRole("button", { name: "Επισύναψη αρχείου" }));
    const file = new File(["From: a@b.example"], "reply.eml", { type: "" });
    await user.upload(dialog.getByLabelText("Αρχείο"), file);
    await user.type(dialog.getByLabelText("Τίτλος (προαιρετικά)"), "Απάντηση μελετητή");
    await user.click(within(dialog.getByText("Αρχείο").closest("form")!).getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpload).toHaveBeenCalledWith(file, "Απάντηση μελετητή");
  });

  it("offers no upload to a role that only reads the log, and none while offline", () => {
    const { unmount } = renderRfis({ selectedId: openRfi.id, documents, onUpload: vi.fn(), roles: ["finance"] });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Επισύναψη αρχείου" })).not.toBeInTheDocument();
    // Reading stays: the links are there.
    expect(within(screen.getByRole("dialog")).getAllByRole("link", { name: /Λήψη/ })).toHaveLength(2);
    unmount();

    renderRfis({ selectedId: openRfi.id, documents, onUpload: vi.fn(), state: "offline" });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Επισύναψη αρχείου" })).not.toBeInTheDocument();
  });
});

describe("RfiSheet — «Απάντηση» and «Κλείσιμο αιτήματος» (owner UAT 25/11/2026)", () => {
  const rfis = buildRfis(now);
  const openRfi = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
  const closedRfi = rfis.find((r) => r.status === "CLOSED")!;
  const answeredRfi = {
    ...openRfi,
    status: "ANSWERED" as const,
    answerEl: "Θύρες EI 60.",
    answeredById: "user-engineer",
    answeredByName: "Ελένη Χριστοδούλου",
    answeredAt: "2026-09-18T08:00:00.000Z",
    answeredOn: "2026-09-17",
  };

  function sheet(props: Partial<Parameters<typeof RfiSheet>[0]> = {}) {
    return renderWithIntl(
      <RfiSheet
        open
        rfi={openRfi}
        canWrite
        today="2026-09-19"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn().mockResolvedValue(true)}
        onCloseRfi={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn().mockResolvedValue(true)}
        documents={[]}
        {...props}
      />,
    );
  }

  it("offers «Απάντηση», «Επεξεργασία» and «Κλείσιμο αιτήματος» on an open RFI", () => {
    sheet();
    const actions = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((label) => ["Απάντηση", "Επεξεργασία", "Κλείσιμο αιτήματος"].includes(label ?? ""));
    expect(actions).toEqual(["Απάντηση", "Επεξεργασία", "Κλείσιμο αιτήματος"]);
  });

  it("offers no action to a role that only reads the log", () => {
    sheet({ canWrite: false });
    const dialog = within(screen.getByRole("dialog"));
    for (const name of ["Απάντηση", "Επεξεργασία", "Κλείσιμο αιτήματος"]) {
      expect(dialog.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("offers no action while offline", () => {
    renderWithIntl(
      <Rfis
        contract={contract}
        rfis={rfis}
        state="offline"
        noPermission={noPermission}
        roles={["project_engineer"]}
        selectedId={openRfi.id}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Απάντηση" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Κλείσιμο αιτήματος" })).not.toBeInTheDocument();
  });

  it("records the answer with today as the day, and refuses a day after today or before it was raised", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn().mockResolvedValue(true);
    sheet({ onAnswer });
    await user.click(screen.getByRole("button", { name: "Απάντηση" }));
    const dialog = within(screen.getByRole("dialog", { name: `Απάντηση στο αίτημα διευκρίνισης ${openRfi.number}` }));
    const day = dialog.getByLabelText("Ημερομηνία απάντησης");
    expect(day).toHaveValue("2026-09-19");

    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(await dialog.findByText("Συμπληρώστε αυτό το πεδίο.")).toBeInTheDocument();

    await user.type(dialog.getByLabelText("Απάντηση"), "Θύρες EI 60.");
    fireEvent.change(day, { target: { value: "2026-09-20" } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(await dialog.findByText("Η ημερομηνία δεν μπορεί να είναι μεταγενέστερη της σημερινής.")).toBeInTheDocument();

    const dayBefore = new Date(`${nicosiaDateOf(openRfi.raisedAt)}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    fireEvent.change(day, { target: { value: dayBefore.toISOString().slice(0, 10) } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(
      await dialog.findByText("Η ημερομηνία απάντησης δεν μπορεί να είναι πριν από την ημερομηνία υποβολής."),
    ).toBeInTheDocument();

    fireEvent.change(day, { target: { value: nicosiaDateOf(openRfi.raisedAt) } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onAnswer).toHaveBeenCalledWith({ answerEl: "Θύρες EI 60.", answeredOn: nicosiaDateOf(openRfi.raisedAt) });
    expect(await screen.findByRole("status")).toHaveTextContent("Η απάντηση καταχωρίστηκε.");
  });

  it("requires a closing note on an unanswered RFI", async () => {
    const user = userEvent.setup();
    const onCloseRfi = vi.fn().mockResolvedValue(true);
    sheet({ onCloseRfi });
    await user.click(screen.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    const dialog = within(screen.getByRole("dialog", { name: `Κλείσιμο αιτήματος διευκρίνισης ${openRfi.number}` }));
    expect(dialog.getByText(/Κλείνει και χωρίς απάντηση/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    expect(onCloseRfi).not.toHaveBeenCalled();
    expect(await dialog.findByText("Το αίτημα δεν έχει απάντηση. Γράψτε γιατί κλείνει.")).toBeInTheDocument();

    await user.type(dialog.getByLabelText("Σημείωση κλεισίματος"), "Διευθετήθηκε επί τόπου.");
    await user.click(dialog.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    expect(onCloseRfi).toHaveBeenCalledWith("Διευθετήθηκε επί τόπου.");
  });

  it("closes an answered RFI without a note, and «Ακύρωση» goes back to the read view", async () => {
    const user = userEvent.setup();
    const onCloseRfi = vi.fn().mockResolvedValue(true);
    sheet({ rfi: answeredRfi, onCloseRfi });
    const read = within(screen.getByRole("dialog"));
    // The answer shows the day it arrived, not the day it was typed in.
    expect(read.getByText(/Ελένη Χριστοδούλου · 17\/09\/2026/)).toBeInTheDocument();
    expect(read.queryByRole("button", { name: "Απάντηση" })).not.toBeInTheDocument();

    await user.click(read.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    await user.click(screen.getByRole("button", { name: "Ακύρωση" }));
    expect(screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${answeredRfi.number}` })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Σημείωση κλεισίματος (προαιρετικά)")).toHaveValue("");
    await user.click(dialog.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    expect(onCloseRfi).toHaveBeenCalledWith("");
  });

  it("shows a closed RFI's closer, day and note, and offers nothing to change", () => {
    sheet({ rfi: closedRfi });
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Έκλεισε από").nextElementSibling?.textContent).toContain("Ελένη Χριστοδούλου");
    expect(dialog.getByText(formatDate(closedRfi.closedAt!))).toBeInTheDocument();
    expect(dialog.getByText("Η στάθμη εφαρμόστηκε στο εργοτάξιο.")).toBeInTheDocument();
    for (const name of ["Απάντηση", "Επεξεργασία", "Κλείσιμο αιτήματος"]) {
      expect(dialog.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
