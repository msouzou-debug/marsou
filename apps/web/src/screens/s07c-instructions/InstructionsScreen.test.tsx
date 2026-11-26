import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { nicosiaDateOf, type ContractDetail, type SiteInstruction } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { formatDate } from "@/lib/format";
import { readBytes } from "@/lib/mail-draft";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildInstructions } from "./fixture";
import { InstructionsScreen } from "./InstructionsScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * Owner request 26/11/2026: «site instructions need same facility to send
 * e-mails as RFI». The screen's own wiring through the real queries and a
 * fake proxy: the recipient and sent day, the attachments on the new form,
 * «Αποθήκευση και αποστολή e-mail» with its Outlook draft, the read view's
 * «Αποστολή με e-mail» and one-click «sent today», and «Αλληλογραφία».
 */
let instructions: SiteInstruction[];
let contract: ContractDetail;
let calls: { method: string; url: string; body: unknown; form?: FormData }[];
let downloads: { name: string; blob: Blob }[];
let lastBlob: Blob | undefined;
let refuseFile: string | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const today = nicosiaDateOf(new Date());

beforeEach(() => {
  instructions = buildInstructions().map((i) =>
    i.id === "instr-1"
      ? { ...i, recipientName: "Μαρία Ιωάννου, Κυριάκου", recipientEmail: "maria@contractor.example", sentOn: null }
      : i,
  );
  contract = buildContractDetail();
  contract = {
    ...contract,
    contractor: { ...contract.contractor, contactName: "Μαρία Ιωάννου", contactEmail: "maria@contractor.example", contactPhone: null, contactSource: "MANUAL" },
  };
  calls = [];
  downloads = [];
  lastBlob = undefined;
  refuseFile = undefined;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return "blob:draft";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (this.download && lastBlob) downloads.push({ name: this.download, blob: lastBlob });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const form = init?.body instanceof FormData ? init.body : undefined;
      calls.push({ method, url, body, form });
      const base = "/api/proxy/contracts/contract-1/site-instructions";
      if (method === "GET" && url === "/api/proxy/contracts/contract-1") return json(contract);
      if (method === "GET" && url === base) return json(instructions);
      if (method === "GET" && url.endsWith("/documents")) return json([]);
      if (method === "POST" && url === base) {
        const created: SiteInstruction = {
          ...buildInstructions()[2],
          id: "instr-new",
          number: 4,
          textEl: body.textEl,
          costImpactFlag: body.costImpactFlag,
          issuedAt: new Date().toISOString(),
          recipientName: body.recipientName ?? null,
          recipientEmail: body.recipientEmail ?? null,
          sentOn: body.sentOn ?? null,
        };
        instructions = [created, ...instructions];
        return json(created, 201);
      }
      if (method === "POST" && url.endsWith("/documents")) {
        const file = form?.get("file") as File;
        if (file.name === refuseFile) {
          return json({ key: "errors.documentMimeRejected", message: "Ο τύπος αρχείου δεν γίνεται δεκτός από το eArchive." }, 422);
        }
        return json(
          {
            id: `doc-${file.name}`,
            titleEl: String(form?.get("titleEl")),
            filename: file.name,
            mime: "application/pdf",
            size: 4,
            protocolNumber: null,
            uploadedByName: "Ελένη Χριστοδούλου",
            createdAt: new Date().toISOString(),
          },
          201,
        );
      }
      if (method === "PATCH") {
        const id = url.split("/").pop()!;
        instructions = instructions.map((i) => (i.id === id ? { ...i, ...body } : i));
        return json(instructions.find((i) => i.id === id));
      }
      return json({}, 404);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <InstructionsScreen contractId="contract-1" roles={["project_engineer"]} noPermission={<div />} />
    </QueryClientProvider>,
  );
}

const documentPosts = () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/documents"));

async function openNew(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Προσθήκη" }));
  return within(screen.getByRole("dialog"));
}

describe("InstructionsScreen — the RFI's e-mail facility (owner request 26/11/2026)", () => {
  it("prefills the recipient from the contractor's contact, and both stay editable", async () => {
    const user = userEvent.setup();
    renderScreen();
    const dialog = await openNew(user);
    expect(dialog.getByLabelText("Παραλήπτης")).toHaveValue(`Μαρία Ιωάννου, ${contract.contractor.name}`);
    expect(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη")).toHaveValue("maria@contractor.example");
    expect(dialog.getByText(/συμπληρώθηκε από τα στοιχεία επικοινωνίας του αναδόχου/)).toBeInTheDocument();
    await user.clear(dialog.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"));
    const send = dialog.getByRole("button", { name: "Αποθήκευση και αποστολή e-mail" });
    expect(send).toBeDisabled();
    expect(dialog.getByText("Για αποστολή με e-mail συμπληρώστε πρώτα το e-mail του παραλήπτη.")).toBeInTheDocument();
  });

  it("«Αποθήκευση και αποστολή e-mail» issues it sent today, downloads SI-<number>.eml with the letter, and files the letter", async () => {
    const user = userEvent.setup();
    renderScreen();
    const dialog = await openNew(user);
    await user.type(dialog.getByLabelText("Οδηγία"), "Κλείστε την πρόσβαση στον διάδρομο Β.");
    const letter = new File(["%PDF letter"], "Επιστολή προς ανάδοχο.pdf", { type: "application/pdf" });
    await user.upload(dialog.getByLabelText("Επιστολή ή e-mail οδηγίας (προαιρετικά)"), letter);
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση και αποστολή e-mail" }));

    const after = within(await screen.findByRole("dialog", { name: "Οδηγία εργοταξίου 4" }));
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/site-instructions"))!;
    expect(create.body).toMatchObject({
      textEl: "Κλείστε την πρόσβαση στον διάδρομο Β.",
      recipientName: `Μαρία Ιωάννου, ${contract.contractor.name}`,
      recipientEmail: "maria@contractor.example",
      sentOn: today,
    });
    expect(documentPosts().map((c) => c.url)).toEqual(["/api/proxy/contracts/contract-1/site-instructions/instr-new/documents"]);
    expect(documentPosts()[0].form?.get("titleEl")).toBe("Επιστολή οδηγίας — Επιστολή προς ανάδοχο.pdf");

    expect(downloads.map((d) => d.name)).toEqual(["SI-4.eml"]);
    const eml = new TextDecoder().decode(await readBytes(downloads[0].blob));
    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).toContain("To: maria@contractor.example\r\n");
    expect(eml).toContain(Buffer.from("%PDF letter").toString("base64"));
    expect(after.getByRole("status")).toHaveTextContent("Κατέβηκε το μήνυμα SI-4.eml");
    expect(after.getByText("Ημερομηνία αποστολής").nextElementSibling).toHaveTextContent(formatDate(today));
  });

  it("keeps the saved instruction when a file is refused, and says which and why", async () => {
    const user = userEvent.setup();
    refuseFile = "scan.pdf";
    renderScreen();
    const dialog = await openNew(user);
    await user.type(dialog.getByLabelText("Οδηγία"), "Αλλάξτε τη διαδρομή των υλικών.");
    await user.upload(dialog.getByLabelText("Επιστολή ή e-mail οδηγίας (προαιρετικά)"), [
      new File(["%PDF"], "letter.pdf", { type: "application/pdf" }),
      new File(["%PDF"], "scan.pdf", { type: "application/pdf" }),
    ]);
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));

    const after = within(await screen.findByRole("dialog", { name: "Οδηγία εργοταξίου 4" }));
    expect(after.getByRole("alert")).toHaveTextContent("«scan.pdf»: Ο τύπος αρχείου δεν γίνεται δεκτός από το eArchive.");
    expect(after.getByLabelText("Αρχείο")).toBeInTheDocument();
    expect(downloads).toEqual([]);
    // A plain save records no sent day.
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/site-instructions"))!.body).not.toHaveProperty("sentOn");
  });

  it("closes after a plain save with nothing to report, as before", async () => {
    const user = userEvent.setup();
    renderScreen();
    const dialog = await openNew(user);
    await user.type(dialog.getByLabelText("Οδηγία"), "Χωρίς συνημμένα.");
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(documentPosts()).toHaveLength(0);
  });

  it("offers «Αποστολή με e-mail» on the read view, then records today in one click", async () => {
    const user = userEvent.setup();
    const target = instructions.find((i) => i.id === "instr-1")!;
    renderScreen();
    await user.click((await screen.findByText(target.textEl)).closest("tr")!);
    const sheet = within(screen.getByRole("dialog", { name: `Οδηγία εργοταξίου ${target.number}` }));
    expect(sheet.getByText("maria@contractor.example")).toBeInTheDocument();
    const link = sheet.getByRole("link", { name: "Αποστολή με e-mail" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("maria@contractor.example");
    // Number — contract — the instruction's first line, cut to 60 with «…».
    expect(url.searchParams.get("subject")).toBe(
      `Οδηγία εργοταξίου ${target.number} — ${contract.contractNo} — Προσθέστε δεύτερη σειρά ηχομονωτικών πάνελ στον θάλαμο μηχα…`,
    );
    expect(url.searchParams.get("body")).toContain("Στην αλληλογραφία σας αναφέρετε τον αριθμό");
    // jsdom does not navigate; the sheet only needs to know it was followed.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    await user.click(sheet.getByRole("button", { name: `Ημερομηνία αποστολής σήμερα, ${formatDate(today)}` }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ sentOn: today });
    expect(await sheet.findByText("Η ημερομηνία αποστολής καταχωρίστηκε.")).toBeInTheDocument();
    expect(sheet.getByText("Αλληλογραφία")).toBeInTheDocument();
  });

  it("edits the recipient and the sent day, and refuses a sent day before the issue day", async () => {
    const user = userEvent.setup();
    const target = instructions.find((i) => i.id === "instr-1")!;
    renderScreen();
    await user.click((await screen.findByText(target.textEl)).closest("tr")!);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Επεξεργασία" }));
    const form = within(screen.getByRole("dialog", { name: `Επεξεργασία οδηγίας εργοταξίου ${target.number}` }));
    expect(form.getByLabelText("Παραλήπτης")).toHaveValue("Μαρία Ιωάννου, Κυριάκου");
    fireEvent.change(form.getByLabelText("Ημερομηνία αποστολής"), { target: { value: "2026-06-01" } });
    await user.click(form.getByRole("button", { name: "Αποθήκευση" }));
    expect(await form.findByText("Η ημερομηνία αποστολής δεν μπορεί να είναι πριν από την ημερομηνία έκδοσης.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    fireEvent.change(form.getByLabelText("Ημερομηνία αποστολής"), { target: { value: "2026-06-03" } });
    await user.clear(form.getByLabelText("Ηλεκτρονικό ταχυδρομείο παραλήπτη"));
    await user.click(form.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({
      recipientName: "Μαρία Ιωάννου, Κυριάκου",
      recipientEmail: null,
      sentOn: "2026-06-03",
    });
  });

  it("keeps «Αλληλογραφία» and its upload on an instruction that became a variation, but not the one-click sent day", async () => {
    const user = userEvent.setup();
    const linked = instructions.find((i) => i.variationId)!;
    instructions = instructions.map((i) => (i.id === linked.id ? { ...i, recipientEmail: "x@contractor.example" } : i));
    renderScreen();
    await user.click((await screen.findByText(linked.textEl)).closest("tr")!);
    const sheet = within(screen.getByRole("dialog", { name: `Οδηγία εργοταξίου ${linked.number}` }));
    const link = sheet.getByRole("link", { name: "Αποστολή με e-mail" });
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(sheet.queryByRole("button", { name: /Ημερομηνία αποστολής σήμερα/ })).not.toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "Επισύναψη αρχείου" })).toBeInTheDocument();
  });
});
