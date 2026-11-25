import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { nicosiaDateOf, type ContractDetail, type Rfi } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildRfis } from "./fixture";
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
let calls: { method: string; url: string; body: unknown }[];
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
      calls.push({ method, url, body });
      if (method === "GET" && url === "/api/proxy/contracts/contract-1") return json(contract);
      if (method === "GET" && url === "/api/proxy/contracts/contract-1/rfis") return json(rfis);
      if (method === "GET" && url.endsWith("/documents")) return json([]);
      if (method === "POST") {
        const answer = onPost(url, body ?? {});
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
