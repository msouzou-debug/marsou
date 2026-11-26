import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { nicosiaDateOf, type ContractDetail, type Rfi } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildRfis } from "./fixture";
import { readBytes } from "@/lib/mail-draft";
import { RfisScreen } from "./RfisScreen";

/**
 * Owner UAT 25/11/2026: «the RFI opens but there is no button to close it».
 * The screen's own wiring, through the real queries and a fake proxy: each
 * action posts to its route, the RFI list and the contract are read again
 * afterwards, and the sheet stays on the RFI, which then shows what the
 * server now holds.
 */
const now = new Date("2026-09-19T09:00:00.000Z");
let rfis: Rfi[];
let contract: ContractDetail;
let calls: { method: string; url: string; body: unknown; form?: FormData }[];
/** What a POST to a route answers, and what it does to the server's list. */
let onPost: (url: string, body: Record<string, unknown>) => { status: number; body: unknown };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  rfis = buildRfis(now);
  contract = buildContractDetail();
  calls = [];
  onPost = () => ({ status: 500, body: {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const form = init?.body instanceof FormData ? init.body : undefined;
      calls.push({ method, url, body, form });
      if (method === "GET" && url === "/api/proxy/contracts/contract-1") return json(contract);
      if (method === "GET" && url === "/api/proxy/contracts/contract-1/rfis") return json(rfis);
      if (method === "GET" && url.endsWith("/documents")) return json([]);
      if (method === "POST") {
        const answer = onPost(url, body ?? (form ? Object.fromEntries(form.entries()) : {}));
        return json(answer.body, answer.status);
      }
      return json({}, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <RfisScreen contractId="contract-1" roles={["project_engineer"]} noPermission={<div />} />
    </QueryClientProvider>,
  );
}

const openRfi = () => rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
const listReads = () => calls.filter((c) => c.method === "GET" && c.url === "/api/proxy/contracts/contract-1/rfis").length;
const contractReads = () => calls.filter((c) => c.method === "GET" && c.url === "/api/proxy/contracts/contract-1").length;

async function openRow(user: ReturnType<typeof userEvent.setup>, rfi: Rfi) {
  await user.click((await screen.findByText(rfi.questionEl)).closest("tr")!);
  return within(screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${rfi.number}` }));
}

describe("RfisScreen — answer and close (owner UAT 25/11/2026)", () => {
  it("answers with the day it arrived, reads the list again and stays on the RFI", async () => {
    const user = userEvent.setup();
    const target = openRfi();
    const today = nicosiaDateOf(new Date());
    onPost = (url, body) => {
      const answered: Rfi = {
        ...target,
        status: "ANSWERED",
        answerEl: String(body.answerEl),
        answeredById: "user-engineer",
        answeredByName: "Ελένη Χριστοδούλου",
        answeredAt: new Date().toISOString(),
        answeredOn: String(body.answeredOn),
      };
      rfis = rfis.map((r) => (r.id === target.id ? answered : r));
      return { status: 200, body: answered };
    };
    renderScreen();

    const sheet = await openRow(user, target);
    const readsBefore = { list: listReads(), contract: contractReads() };
    await user.click(sheet.getByRole("button", { name: "Απάντηση" }));
    const form = within(screen.getByRole("dialog", { name: `Απάντηση στο αίτημα διευκρίνισης ${target.number}` }));
    expect(form.getByLabelText("Ημερομηνία απάντησης")).toHaveValue(today);
    await user.type(form.getByLabelText("Απάντηση"), "Θύρες EI 60.");
    await user.click(form.getByRole("button", { name: "Αποθήκευση" }));

    expect(await screen.findByText("Θύρες EI 60.")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe(`/api/proxy/contracts/contract-1/rfis/${target.id}/answer`);
    expect(post.body).toEqual({ answerEl: "Θύρες EI 60.", answeredOn: today });
    expect(listReads()).toBeGreaterThan(readsBefore.list);
    expect(contractReads()).toBeGreaterThan(readsBefore.contract);

    // The read view of the same RFI, answered, with a close and no answer.
    const after = within(screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${target.number}` }));
    expect(after.getByRole("status")).toHaveTextContent("Η απάντηση καταχωρίστηκε.");
    expect(after.queryByRole("button", { name: "Απάντηση" })).not.toBeInTheDocument();
    expect(after.getByRole("button", { name: "Κλείσιμο αιτήματος" })).toBeInTheDocument();
    // And the table says so too.
    expect(within(screen.getByRole("table")).getByText(target.questionEl).closest("tr")!.textContent).toContain("Απαντήθηκε");
  });

  it("closes an unanswered RFI with its note, reads the list again and shows it closed", async () => {
    const user = userEvent.setup();
    const target = openRfi();
    onPost = (url, body) => {
      const closed: Rfi = {
        ...target,
        status: "CLOSED",
        closedById: "user-engineer",
        closedByName: "Ελένη Χριστοδούλου",
        closedAt: "2026-09-19T08:00:00.000Z",
        closingNote: String(body.closingNote),
      };
      rfis = rfis.map((r) => (r.id === target.id ? closed : r));
      return { status: 200, body: closed };
    };
    renderScreen();

    const sheet = await openRow(user, target);
    const readsBefore = listReads();
    await user.click(sheet.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    const form = within(screen.getByRole("dialog", { name: `Κλείσιμο αιτήματος διευκρίνισης ${target.number}` }));
    await user.type(form.getByLabelText("Σημείωση κλεισίματος"), "Διευθετήθηκε στο εργοτάξιο.");
    await user.click(form.getByRole("button", { name: "Κλείσιμο αιτήματος" }));

    expect(await screen.findByText("Διευθετήθηκε στο εργοτάξιο.")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe(`/api/proxy/contracts/contract-1/rfis/${target.id}/close`);
    expect(post.body).toEqual({ closingNote: "Διευθετήθηκε στο εργοτάξιο." });
    expect(listReads()).toBeGreaterThan(readsBefore);

    const after = within(screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${target.number}` }));
    expect(after.getByRole("status")).toHaveTextContent("Το αίτημα διευκρίνισης έκλεισε.");
    expect(after.getByText("Έκλεισε από").nextElementSibling?.textContent).toContain("Ελένη Χριστοδούλου");
    expect(after.queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(after.queryByRole("button", { name: "Κλείσιμο αιτήματος" })).not.toBeInTheDocument();
  });

  it("shows the API's sentence and stays on the form when the close is refused", async () => {
    const user = userEvent.setup();
    onPost = () => ({
      status: 422,
      body: { key: "errors.rfiAlreadyClosed", message: "Το αίτημα διευκρίνισης είναι ήδη κλειστό." },
    });
    renderScreen();
    const target = openRfi();
    const sheet = await openRow(user, target);
    await user.click(sheet.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    const form = within(screen.getByRole("dialog", { name: `Κλείσιμο αιτήματος διευκρίνισης ${target.number}` }));
    await user.type(form.getByLabelText("Σημείωση κλεισίματος"), "Δεν χρειάζεται.");
    await user.click(form.getByRole("button", { name: "Κλείσιμο αιτήματος" }));
    expect(await form.findByText(/είναι ήδη κλειστό/)).toBeInTheDocument();
  });

  it("prefills a new RFI's recipient from the contractor's contact, and the user can change it", async () => {
    const user = userEvent.setup();
    contract = {
      ...contract,
      contractor: {
        ...contract.contractor,
        contactName: "Μαρία Ιωάννου",
        contactEmail: "maria@contractor.example",
        contactPhone: "22 123456",
        contactSource: "MANUAL",
      },
    };
    onPost = () => ({ status: 201, body: openRfi() });
    renderScreen();
    await user.click(await screen.findByRole("button", { name: "Προσθήκη" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Παραλήπτης")).toHaveValue(`Μαρία Ιωάννου, ${contract.contractor.name}`);
    expect(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη")).toHaveValue("maria@contractor.example");
    expect(dialog.getByText(/συμπληρώθηκε από τα στοιχεία επικοινωνίας του αναδόχου/)).toBeInTheDocument();

    await user.type(dialog.getByLabelText("Ερώτηση"), "Ποιο χρώμα;");
    await user.clear(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"));
    await user.type(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"), "site@contractor.example");
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      recipientName: `Μαρία Ιωάννου, ${contract.contractor.name}`,
      recipientEmail: "site@contractor.example",
    });
  });
});

// Owner request 26/11/2026: «When the RFI is raised there is no logic to save
// and then send e-mail; it should be on the same screen: attach e-mail/letter
// document and save, or send e-mail directly. The answer is missing a field to
// attach the mail/letter etc. from the contractor.»
describe("RfisScreen — attach and save, or save and send e-mail (owner request 26/11/2026)", () => {
  const documentPosts = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/documents"));
  let downloads: { name: string; blob: Blob }[];
  let lastBlob: Blob | undefined;

  beforeEach(() => {
    downloads = [];
    lastBlob = undefined;
    // jsdom has no object URLs and does not download; record what would have been saved.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      lastBlob = blob;
      return "blob:draft";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      if (this.download && lastBlob) downloads.push({ name: this.download, blob: lastBlob });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  /** The new RFI the fake server stores: number 4, the body's recipient and sent day. */
  function createdFrom(body: Record<string, unknown>): Rfi {
    return {
      ...openRfi(),
      id: "rfi-new",
      number: 4,
      questionEl: String(body.questionEl),
      recipientName: String(body.recipientName),
      recipientEmail: (body.recipientEmail as string | undefined) ?? null,
      sentOn: (body.sentOn as string | undefined) ?? null,
      raisedAt: new Date().toISOString(),
    };
  }

  function serve(documents: (form: Record<string, unknown>) => { status: number; body: unknown }) {
    onPost = (url, body) => {
      if (url === "/api/proxy/contracts/contract-1/rfis") {
        const created = createdFrom(body);
        rfis = [created, ...rfis];
        return { status: 201, body: created };
      }
      if (url.endsWith("/documents")) return documents(body);
      return { status: 500, body: {} };
    };
  }

  const filed = (form: Record<string, unknown>) => ({
    status: 201,
    body: {
      id: `doc-${String(form.titleEl)}`,
      titleEl: String(form.titleEl),
      filename: (form.file as File).name,
      mime: "application/pdf",
      size: 10,
      protocolNumber: null,
      uploadedByName: "Ελένη Χριστοδούλου",
      createdAt: new Date().toISOString(),
    },
  });

  async function fillNew(user: ReturnType<typeof userEvent.setup>, files: File[]) {
    await user.click(await screen.findByRole("button", { name: "Προσθήκη" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByLabelText("Ερώτηση"), "Ποιο χρώμα;");
    await user.type(dialog.getByLabelText("Παραλήπτης"), "Μαρία Ιωάννου, Ανάδοχος");
    if (files.length) await user.upload(dialog.getByLabelText("Επιστολή ή e-mail αιτήματος (προαιρετικά)"), files);
    return dialog;
  }

  it("«Αποθήκευση» creates the RFI, then files every attached file against it, and closes", async () => {
    const user = userEvent.setup();
    serve(filed);
    renderScreen();
    const letter = new File(["%PDF-1.7"], "Επιστολή 26-11.pdf", { type: "application/pdf" });
    const sent = new File(["Outlook"], "sent.msg", { type: "" });
    const dialog = await fillNew(user, [letter, sent]);
    const chosen = within(dialog.getByRole("list", { name: "Αρχεία προς επισύναψη" }));
    expect(chosen.getAllByRole("listitem").map((item) => item.querySelector(".truncate")?.textContent)).toEqual([
      "Επιστολή 26-11.pdf",
      "sent.msg",
    ]);
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts[0].url).toBe("/api/proxy/contracts/contract-1/rfis");
    expect(posts[0].body).not.toHaveProperty("sentOn");
    expect(documentPosts().map((c) => c.url)).toEqual([
      "/api/proxy/contracts/contract-1/rfis/rfi-new/documents",
      "/api/proxy/contracts/contract-1/rfis/rfi-new/documents",
    ]);
    expect(documentPosts().map((c) => c.form?.get("titleEl"))).toEqual([
      "Επιστολή αιτήματος — Επιστολή 26-11.pdf",
      "Επιστολή αιτήματος — sent.msg",
    ]);
    expect(documentPosts()[0].form?.get("file")).toBe(letter);
    expect(downloads).toEqual([]);
  });

  it("«Αποθήκευση και αποστολή e-mail» is disabled, and says why, until there is a recipient e-mail", async () => {
    const user = userEvent.setup();
    renderScreen();
    const dialog = await fillNew(user, []);
    const send = dialog.getByRole("button", { name: "Αποθήκευση και αποστολή e-mail" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Για αποστολή με e-mail συμπληρώστε πρώτα το e-mail του παραλήπτη.");
    await user.type(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"), "maria@contractor.example");
    expect(send).toBeEnabled();
    expect(send).toHaveAccessibleDescription(/το Outlook το ανοίγει ως νέο μήνυμα/);
  });

  it("«Αποθήκευση και αποστολή e-mail» saves with today as the sent day, downloads RFI-<number>.eml with the files, and files them", async () => {
    const user = userEvent.setup();
    serve(filed);
    renderScreen();
    const letter = new File(["%PDF-1.7 letter"], "Επιστολή.pdf", { type: "application/pdf" });
    const dialog = await fillNew(user, [letter]);
    await user.type(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"), "maria@contractor.example");
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση και αποστολή e-mail" }));

    const after = within(await screen.findByRole("dialog", { name: "Αίτημα διευκρίνισης 4" }));
    const create = calls.find((c) => c.method === "POST" && c.url === "/api/proxy/contracts/contract-1/rfis")!;
    expect(create.body).toMatchObject({ recipientEmail: "maria@contractor.example", sentOn: nicosiaDateOf(new Date()) });
    expect(documentPosts()).toHaveLength(1);
    expect(documentPosts()[0].form?.get("titleEl")).toBe("Επιστολή αιτήματος — Επιστολή.pdf");

    expect(downloads.map((d) => d.name)).toEqual(["RFI-4.eml"]);
    const eml = new TextDecoder().decode(await readBytes(downloads[0].blob));
    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).toContain("To: maria@contractor.example\r\n");
    expect(eml).not.toMatch(/^From:/m);
    expect(eml).toMatch(/Content-Disposition: attachment;\r\n filename\*0\*=UTF-8''/);
    expect(eml).toContain(Buffer.from("%PDF-1.7 letter").toString("base64"));
    // The body is buildRfiMail's text.
    const textPart = /charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/.exec(eml)![1];
    expect(Buffer.from(textPart.replace(/\r\n/g, ""), "base64").toString("utf8")).toContain("Αίτημα διευκρίνισης 4\r\n");

    expect(after.getByRole("status")).toHaveTextContent("Κατέβηκε το μήνυμα RFI-4.eml");
    expect(after.getByRole("status")).toHaveTextContent("με ημερομηνία αποστολής σήμερα");
  });

  it("keeps the saved RFI when a file is refused: opens it, says which file and why, and offers the retry", async () => {
    const user = userEvent.setup();
    serve((form) =>
      (form.file as File).name === "scan.pdf"
        ? { status: 422, body: { key: "errors.documentMimeRejected", message: "Ο τύπος αρχείου δεν γίνεται δεκτός από το eArchive." } }
        : filed(form),
    );
    renderScreen();
    const good = new File(["%PDF"], "letter.pdf", { type: "application/pdf" });
    const bad = new File(["%PDF"], "scan.pdf", { type: "application/pdf" });
    const dialog = await fillNew(user, [good, bad]);
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));

    const after = within(await screen.findByRole("dialog", { name: "Αίτημα διευκρίνισης 4" }));
    const alert = after.getByRole("alert");
    expect(alert).toHaveTextContent("Η εγγραφή αποθηκεύτηκε, αλλά δεν επισυνάφθηκαν τα παρακάτω αρχεία.");
    expect(alert).toHaveTextContent("«scan.pdf»: Ο τύπος αρχείου δεν γίνεται δεκτός από το eArchive.");
    expect(alert).not.toHaveTextContent("letter.pdf");
    // The read view's own upload form is open for the retry.
    expect(after.getByLabelText("Αρχείο")).toBeInTheDocument();
    expect(documentPosts()).toHaveLength(2);
  });

  it("files the contractor's reply after the answer, as «Απάντηση αναδόχου», and keeps the answer if the file fails", async () => {
    const user = userEvent.setup();
    const target = openRfi();
    onPost = (url, body) => {
      if (url.endsWith("/answer")) {
        const answered: Rfi = {
          ...target,
          status: "ANSWERED",
          answerEl: String(body.answerEl),
          answeredById: "user-engineer",
          answeredByName: "Ελένη Χριστοδούλου",
          answeredAt: new Date().toISOString(),
          answeredOn: String(body.answeredOn),
        };
        rfis = rfis.map((r) => (r.id === target.id ? answered : r));
        return { status: 200, body: answered };
      }
      if (url.endsWith("/documents")) {
        return (body.file as File).name === "reply.eml"
          ? filed(body)
          : { status: 422, body: { key: "errors.documentTooLarge", message: "Το αρχείο είναι πολύ μεγάλο." } };
      }
      return { status: 500, body: {} };
    };
    renderScreen();
    const sheet = await openRow(user, target);
    await user.click(sheet.getByRole("button", { name: "Απάντηση" }));
    const form = within(screen.getByRole("dialog", { name: `Απάντηση στο αίτημα διευκρίνισης ${target.number}` }));
    await user.type(form.getByLabelText("Απάντηση"), "Θύρες EI 60.");
    const reply = new File(["From: x"], "reply.eml", { type: "message/rfc822" });
    const scan = new File(["%PDF"], "scan.pdf", { type: "application/pdf" });
    await user.upload(form.getByLabelText("Επιστολή ή e-mail αναδόχου (προαιρετικά)"), [reply, scan]);
    await user.click(form.getByRole("button", { name: "Αποθήκευση" }));

    expect(await screen.findByText("Θύρες EI 60.")).toBeInTheDocument();
    expect(documentPosts().map((c) => c.form?.get("titleEl"))).toEqual([
      "Απάντηση αναδόχου — reply.eml",
      "Απάντηση αναδόχου — scan.pdf",
    ]);
    const after = within(screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${target.number}` }));
    expect(after.getByRole("status")).toHaveTextContent("Η απάντηση καταχωρίστηκε.");
    expect(after.getByRole("alert")).toHaveTextContent("«scan.pdf»: Το αρχείο είναι πολύ μεγάλο.");
  });

  it("answers without a file, as before: the reply attachment is optional", async () => {
    const user = userEvent.setup();
    const target = openRfi();
    onPost = (url, body) => {
      const answered: Rfi = { ...target, status: "ANSWERED", answerEl: String(body.answerEl), answeredAt: new Date().toISOString() };
      rfis = rfis.map((r) => (r.id === target.id ? answered : r));
      return { status: 200, body: answered };
    };
    renderScreen();
    const sheet = await openRow(user, target);
    await user.click(sheet.getByRole("button", { name: "Απάντηση" }));
    const form = within(screen.getByRole("dialog"));
    await user.type(form.getByLabelText("Απάντηση"), "Ναι.");
    await user.click(form.getByRole("button", { name: "Αποθήκευση" }));
    expect(await screen.findByText("Ναι.")).toBeInTheDocument();
    expect(documentPosts()).toHaveLength(0);
  });
});
