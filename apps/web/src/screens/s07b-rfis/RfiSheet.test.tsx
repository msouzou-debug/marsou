import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import el from "@/i18n/el.json";
import { renderWithIntl } from "@/test/render";
import { formatDate } from "@/lib/format";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildRfis } from "./fixture";
import { RfiSheet } from "./RfiSheet";
import { Rfis } from "./Rfis";

const noPermission = <div>no permission</div>;
const contract = buildContractDetail();
const now = new Date("2026-09-19T09:00:00.000Z");
const rfis = buildRfis(now);
const openRfi = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
const noEmailRfi = rfis.find((r) => r.status === "OPEN" && r.slaState === "BREACHED")!;
const closedRfi = rfis.find((r) => r.status === "CLOSED")!;

// Owner UAT 25/11/2026: «When you close an RFI there is no close button; it
// stays in limbo» and «the fields date due and status remain in the view
// area of the RFI».
describe("RfiSheet — the way out (owner UAT 25/11/2026)", () => {
  function renderList(onSelect = vi.fn()) {
    return renderWithIntl(
      <Rfis
        contract={contract}
        rfis={rfis}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        selectedId={openRfi.id}
        onSelect={onSelect}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
      />,
    );
  }

  it("covers the table: the sheet and its backdrop sit above the sticky header and the top bar", () => {
    renderList();
    const dialog = screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${openRfi.number}` });
    expect(dialog.className).toMatch(/\bz-40\b/);
    // The table's sticky header is z-10; the top bar z-30.
    expect(document.querySelector("thead")?.className).toMatch(/\bz-10\b/);
    expect(screen.getByTestId("side-sheet-backdrop").className).toMatch(/\bz-40\b/);
  });

  it("goes back to the list from «Πίσω στη λίστα», Escape or the backdrop", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderList(onSelect);
    await user.click(screen.getByRole("button", { name: "Πίσω στη λίστα" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(screen.getByTestId("side-sheet-backdrop"));
    expect(onSelect.mock.calls).toEqual([[null], [null], [null]]);
  });

  it("after «Κλείσιμο αιτήματος», shows the closed RFI with «Πίσω στη λίστα» still there", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const closed = {
      ...openRfi,
      status: "CLOSED" as const,
      closedByName: "Ελένη Χριστοδούλου",
      closedAt: now.toISOString(),
      closingNote: "Δεν χρειάζεται πια.",
    };
    const view = renderWithIntl(
      <RfiSheet open rfi={openRfi} canWrite today="2026-09-19" onClose={onClose} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn().mockResolvedValue(true)} documents={[]} />,
    );
    await user.click(screen.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    await user.type(screen.getByLabelText("Σημείωση κλεισίματος"), "Δεν χρειάζεται πια.");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    // The screen refetches and hands the sheet the closed RFI.
    view.rerender(
      <NextIntlClientProvider locale="el" messages={el} timeZone="Europe/Nicosia">
        <RfiSheet open rfi={closed} canWrite today="2026-09-19" onClose={onClose} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} documents={[]} />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Το αίτημα διευκρίνισης έκλεισε.");
    expect(screen.getByText("Δεν χρειάζεται πια.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Πίσω στη λίστα" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Owner UAT 25/11/2026: «The RFI should go through e-mail; it does not right now.»
describe("RfiSheet — «Αποστολή με e-mail» (owner UAT 25/11/2026)", () => {
  const facts = { contractNo: "ΤΥ/2026/001", contractorName: "Δοκιμαστική Εργοληπτική Λτδ", projectCode: "PRJ-014", projectTitle: "Ανακαίνιση" };

  function sheet(props: Partial<Parameters<typeof RfiSheet>[0]> = {}) {
    return renderWithIntl(
      <RfiSheet
        open
        rfi={openRfi}
        canWrite
        today="2026-09-19"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(true)}
        onMarkSent={vi.fn().mockResolvedValue(true)}
        contractFacts={facts}
        documents={[]}
        {...props}
      />,
    );
  }

  /** jsdom cannot follow a mailto: link; the click is what matters here. */
  async function openMail(user: ReturnType<typeof userEvent.setup>) {
    const link = screen.getByRole("link", { name: "Αποστολή με e-mail" });
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
  }

  it("opens the mail program with the recipient, subject and body filled in", () => {
    sheet();
    const link = screen.getByRole("link", { name: "Αποστολή με e-mail" });
    const href = link.getAttribute("href")!;
    expect(href.startsWith("mailto:m.andreou@architects.example?")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe(`Αίτημα διευκρίνισης ${openRfi.number} — ΤΥ/2026/001 — ${openRfi.questionEl}`);
    expect(url.searchParams.get("body")).toContain(`Προθεσμία απάντησης: ${formatDate(openRfi.slaDueAt)}`);
    expect(url.searchParams.get("body")).toContain(`τον αριθμό «Αίτημα διευκρίνισης ${openRfi.number}»`);
    expect(link).toHaveAccessibleDescription(/Το eCapital δεν στέλνει μηνύματα μόνο του/);
  });

  it("is disabled, with the reason, when there is no recipient e-mail", () => {
    sheet({ rfi: noEmailRfi });
    const button = screen.getByRole("button", { name: "Αποστολή με e-mail" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Δεν έχει καταχωριστεί e-mail παραλήπτη. Συμπληρώστε το με «Επεξεργασία».");
    expect(screen.queryByRole("link", { name: "Αποστολή με e-mail" })).toBeNull();
  });

  it("after opening, reminds to file the sent e-mail and sets the sent day to today in one click", async () => {
    const user = userEvent.setup();
    const onMarkSent = vi.fn().mockResolvedValue(true);
    sheet({ onMarkSent });
    await openMail(user);
    expect(screen.getByRole("status")).toHaveTextContent("επισυνάψτε το απεσταλμένο μήνυμα στην «Αλληλογραφία»");
    await user.click(screen.getByRole("button", { name: "Ημερομηνία αποστολής σήμερα, 19/09/2026" }));
    expect(onMarkSent).toHaveBeenCalledWith("2026-09-19");
    expect(await screen.findByText("Η ημερομηνία αποστολής καταχωρίστηκε.")).toBeInTheDocument();
  });

  it("does not offer «sent today» when today is already recorded", async () => {
    const user = userEvent.setup();
    sheet({ rfi: { ...openRfi, sentOn: "2026-09-19" } });
    await openMail(user);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ημερομηνία αποστολής σήμερα/ })).toBeNull();
  });

  it("offers no e-mail on a closed RFI or to a reader", () => {
    const { unmount } = sheet({ rfi: { ...closedRfi, recipientEmail: "x@example.com" } });
    expect(screen.queryByText("Αποστολή με e-mail")).toBeNull();
    unmount();
    sheet({ canWrite: false });
    expect(screen.queryByText("Αποστολή με e-mail")).toBeNull();
  });

  it("is wired from the list with the contract's number, contractor and project", () => {
    renderWithIntl(
      <Rfis
        contract={contract}
        rfis={rfis}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        selectedId={openRfi.id}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
      />,
    );
    const url = new URL(screen.getByRole("link", { name: "Αποστολή με e-mail" }).getAttribute("href")!);
    expect(url.searchParams.get("subject")).toContain(contract.contractNo);
    expect(url.searchParams.get("body")).toContain(`Σύμβαση: ${contract.contractNo}, ${contract.contractorName}`);
    expect(url.searchParams.get("body")).toContain(`Έργο: ${contract.project.code} — ${contract.project.titleEl}`);
  });
});
