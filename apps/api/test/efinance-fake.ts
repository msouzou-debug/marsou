import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A fake eFinance, in-process, on a free loopback port (ADR-0029 §7).
 *
 * It answers the routes of eFinance's integration record the way the record
 * says they answer: the bearer token or 401 UNAUTHENTICATED, a forwarded-edge
 * header or 403 LOOPBACK_ONLY, the one error envelope, money as 2-decimal
 * strings, `limit`/`cursor` paging with `next_cursor` null at the end, the
 * one write with its 409 CONFLICT when the hospital or the budget code moved.
 * The fixtures are plain arrays the tests change between steps.
 *
 * The token below is a test value. It is not, and does not look like, the
 * token eFinance generates on the server.
 */
export const FAKE_TOKEN = "test-efinance-token-not-a-real-secret";

export interface FakeInvoiceLine {
  descr: string | null;
  qty: string | number | null;
  unit_price: string | null;
  line_total: string | null;
  vat_rate: string | number | null;
  gl_account: string | null;
  cost_centre: string | null;
  budget_code: string | null;
  wbs_code: string | null;
}

export interface FakeInvoice {
  id: number;
  invoice_no: string | null;
  invoice_date: string | null;
  sap_batch_date: string | null;
  vendor_code: string | null;
  vendor_name: string | null;
  entity_code: string | null;
  currency: string;
  net: string | null;
  vat: string | null;
  gross: string | null;
  status: string | null;
  ledger: "booked" | "in_flight" | "reversed" | "rejected";
  cap_ref: string | null;
  reversed_at: string | null;
  reversal_sap_doc_no: string | null;
  reversal_reason: string | null;
  updated_at: string;
  lines: FakeInvoiceLine[];
}

export interface FakeRequisition {
  id: number;
  number: string;
  description: string | null;
  justification: string | null;
  entity_code: string | null;
  cost_centre: string | null;
  budget_code: string | null;
  gl_account: string | null;
  amount: string | null;
  currency: string;
  status: string;
  cap_ref: string | null;
  po_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeContract {
  project_ref: string;
  title: string;
  entity_code: string;
  budget_code: string;
  vendor_code: string;
  current_value: string;
  status: "active" | "closed";
  updated_at: string;
}

const FORWARDED = ["cf-connecting-ip", "x-forwarded-for", "x-real-ip", "forwarded", "cf-ray"];
const MONEY = /^-?\d+\.\d{2}$/;
const CAP_REF = /^CAP-\d{4}-\d{4,}$/;

export class FakeEFinance {
  private server: Server | null = null;
  url = "";

  entities = [
    { code: "NGH", archive_code: "NGH", name: "Γενικό Νοσοκομείο Λευκωσίας", type: "hospital", active: true },
    { code: "PAP", archive_code: "PAF", name: "Γενικό Νοσοκομείο Πάφου", type: "hospital", active: true },
    { code: "AMB", archive_code: null, name: "Υπηρεσία Ασθενοφόρων", type: "service", active: false },
  ];
  budgetCodes = [
    { active: true, category: "Εξοπλισμός", code: "7402", description: "MEDICAL & OTHER EQUI", kind: "capex" },
    { active: true, category: "Εξοπλισμός", code: "7501", description: "MACHINERY", name: "Μηχανήματα και εξοπλισμός", kind: "capex" },
    { active: false, category: "Οχήματα", code: "7553", description: "MOTORCYCLES", kind: "capex" },
  ];
  vendors = [
    { vendor_code: "100123", name: "ΚΑΤΑΣΚΕΥΑΣΤΙΚΗ ΑΛΦΑ ΛΤΔ", vat: "CY10012300A", blocked: false, active: true, sap_batch: "2026-09" },
    { vendor_code: "100124", name: "Ηλεκτρομηχανική Βήτα", vat: null, blocked: false, active: true, sap_batch: "2026-09" },
    { vendor_code: "100125", name: "Gamma Medical Ltd", vat: "CY10012500C", blocked: true, active: true, sap_batch: "2026-09" },
    { vendor_code: "100126", name: "Δέλτα Κλιματισμός", vat: null, blocked: false, active: true, sap_batch: "2026-09" },
    { vendor_code: "100127", name: "Έψιλον Ανελκυστήρες", vat: null, blocked: false, active: false, sap_batch: "2026-09" },
  ];
  positions: {
    budget_code: string;
    entity_code: string;
    archive_code: string;
    year: number;
    allocated: string | null;
    booked: string | null;
    in_flight: string | null;
    requisitions: string | null;
    available: string | null;
  }[] = [
    {
      budget_code: "7402",
      entity_code: "NGH",
      archive_code: "NGH",
      year: 2026,
      allocated: "1000000.00",
      booked: "250000.00",
      in_flight: "40000.00",
      requisitions: "100000.00",
      available: "650000.00",
    },
  ];
  positionAsOf = "2026-10-02T08:00:00+00:00";
  invoices: FakeInvoice[] = [];
  requisitions: FakeRequisition[] = [];
  contracts = new Map<string, FakeContract>();

  /** What the tests read back. */
  puts: { capRef: string; body: FakeContract }[] = [];
  calls: { method: string; path: string; query: Record<string, string>; headers: Record<string, unknown> }[] = [];
  /** Page size for every list; the record's default is 200. */
  pageSize = 200;
  /** Hold every answer this long, for the timeout test. */
  delayMs = 0;
  /** Answer every write with a bare 503, the way a proxy in the way would. */
  outage = false;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  callsTo(path: string): number {
    return this.calls.filter((call) => call.path === path).length;
  }

  /** booked, in flight and requisitions for one reference, as eFinance would sum them. */
  spendOf(capRef: string): { booked: string; in_flight: string; requisitions: string } {
    const sumLines = (ledger: FakeInvoice["ledger"]) =>
      this.invoices
        .filter((invoice) => invoice.cap_ref === capRef && invoice.ledger === ledger)
        .flatMap((invoice) => invoice.lines)
        .reduce((sum, line) => sum + Number(line.line_total ?? 0), 0);
    const requisitions = this.requisitions
      .filter((requisition) => requisition.cap_ref === capRef && requisition.status === "approved")
      .reduce((sum, requisition) => sum + Number(requisition.amount ?? 0), 0);
    return {
      booked: sumLines("booked").toFixed(2),
      in_flight: sumLines("in_flight").toFixed(2),
      requisitions: requisitions.toFixed(2),
    };
  }

  private contractAnswer(capRef: string, stored: FakeContract) {
    const spend = this.spendOf(capRef);
    const remaining = Number(stored.current_value) - Number(spend.booked) - Number(spend.requisitions);
    return { cap_ref: capRef, ...stored, spend, remaining: remaining.toFixed(2) };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const query = Object.fromEntries(url.searchParams.entries());
    this.calls.push({ method: req.method ?? "GET", path: url.pathname, query, headers: { ...req.headers } });
    const body = await readBody(req);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    const send = (status: number, payload: unknown) => {
      if (res.destroyed) return;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const fail = (status: number, code: string, message: string) => send(status, { error: { code, message } });

    if (FORWARDED.some((header) => req.headers[header] !== undefined)) {
      return fail(403, "LOOPBACK_ONLY", "forwarded header on a loopback call");
    }
    if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) {
      return fail(401, "UNAUTHENTICATED", "missing or wrong token");
    }

    const path = url.pathname;
    if (this.outage && req.method === "PUT") {
      res.writeHead(503, { "Content-Type": "text/html" });
      res.end("<html><body>Service Unavailable</body></html>");
      return;
    }
    const paged = <T>(items: T[]) => {
      const limit = Math.min(Number(query.limit ?? 200), 500, this.pageSize);
      const offset = Number(query.cursor ?? 0);
      const slice = items.slice(offset, offset + limit);
      const next = offset + limit < items.length ? String(offset + limit) : null;
      return { items: slice, next_cursor: next };
    };
    const capital = <T extends { cap_ref: string | null; updated_at: string }>(items: T[]) => {
      if (query.ref) return items.filter((item) => item.cap_ref === query.ref);
      if (query.updated_since) {
        const since = Date.parse(query.updated_since);
        return items
          .filter((item) => item.cap_ref !== null && Date.parse(item.updated_at) > since)
          .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
      }
      return null;
    };

    if (req.method === "GET" && path === "/api/v1/master/entities") return send(200, paged(this.entities));
    if (req.method === "GET" && path === "/api/v1/master/budget-codes") {
      return send(200, paged(this.budgetCodes.filter((row) => !query.kind || row.kind === query.kind)));
    }
    if (req.method === "GET" && path === "/api/v1/master/vendors") return send(200, paged(this.vendors));
    if (req.method === "GET" && path === "/api/v1/master/cost-centres") {
      return send(200, paged([{ code: "NGH100", name: "Τεχνικές Υπηρεσίες", entity_code: "NGH", active: true }]));
    }
    if (req.method === "GET" && path === "/api/v1/budget/position") {
      const year = Number(query.year);
      const items = this.positions.filter(
        (row) =>
          row.year === year &&
          (!query.entity || row.entity_code === query.entity || row.archive_code === query.entity) &&
          (!query.code || row.budget_code === query.code),
      );
      return send(200, { items, as_of: this.positionAsOf });
    }
    if (req.method === "GET" && path === "/api/v1/capital/invoices") {
      const items = capital(this.invoices);
      if (!items) return fail(400, "SCHEMA_INVALID", "ref or updated_since is required");
      return send(200, paged(items));
    }
    if (req.method === "GET" && path === "/api/v1/capital/requisitions") {
      const items = capital(this.requisitions);
      if (!items) return fail(400, "SCHEMA_INVALID", "ref or updated_since is required");
      return send(200, paged(items));
    }

    const contractPath = /^\/api\/v1\/capital\/contracts\/([^/]+)$/.exec(path);
    if (contractPath) {
      const capRef = decodeURIComponent(contractPath[1]);
      if (req.method === "GET") {
        const stored = this.contracts.get(capRef);
        if (!stored) return fail(404, "NOT_FOUND", `no contract ${capRef}`);
        return send(200, this.contractAnswer(capRef, stored));
      }
      if (req.method === "PUT") {
        const problem = invalidContract(capRef, body);
        if (problem) return fail(400, "SCHEMA_INVALID", problem);
        const next = body as FakeContract;
        const existing = this.contracts.get(capRef);
        if (existing && (existing.entity_code !== next.entity_code || existing.budget_code !== next.budget_code)) {
          return fail(409, "CONFLICT", `${capRef} already exists under ${existing.entity_code}/${existing.budget_code}`);
        }
        this.contracts.set(capRef, next);
        this.puts.push({ capRef, body: next });
        return send(200, this.contractAnswer(capRef, next));
      }
    }
    return fail(404, "NOT_FOUND", `no route ${req.method} ${path}`);
  }
}

function invalidContract(capRef: string, body: unknown): string | null {
  if (!CAP_REF.test(capRef)) return "cap_ref";
  if (!body || typeof body !== "object") return "body";
  const value = body as Record<string, unknown>;
  for (const field of ["project_ref", "title", "entity_code", "budget_code", "vendor_code", "current_value", "status", "updated_at"]) {
    if (typeof value[field] !== "string" || value[field] === "") return field;
  }
  if (!MONEY.test(value.current_value as string)) return "current_value";
  if (value.status !== "active" && value.status !== "closed") return "status";
  if (!(value.updated_at as string).endsWith("+00:00")) return "updated_at";
  return null;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** A booked invoice with two lines, the way the record describes one. */
export function bookedInvoice(id: number, capRef: string, updatedAt: string): FakeInvoice {
  return {
    id,
    invoice_no: `INV-${id}`,
    invoice_date: "2026-08-20",
    sap_batch_date: "2026-09-15",
    vendor_code: "100123",
    vendor_name: "ΚΑΤΑΣΚΕΥΑΣΤΙΚΗ ΑΛΦΑ ΛΤΔ",
    entity_code: "NGH",
    currency: "EUR",
    net: "30000.00",
    vat: "5700.00",
    gross: "35700.00",
    status: "approved",
    ledger: "booked",
    cap_ref: capRef,
    reversed_at: null,
    reversal_sap_doc_no: null,
    reversal_reason: null,
    updated_at: updatedAt,
    lines: [
      {
        descr: "Εργασίες σκυροδέτησης",
        qty: "1.000",
        unit_price: "20000.00",
        line_total: "20000.00",
        vat_rate: "19.00",
        gl_account: "7402000",
        cost_centre: "NGH100",
        budget_code: "7402",
        wbs_code: "NGH-2026-001.01",
      },
      {
        descr: "Ηλεκτρολογικά",
        qty: 2,
        unit_price: "5000.00",
        line_total: "10000.00",
        vat_rate: 19,
        gl_account: "7402000",
        cost_centre: "NGH101",
        budget_code: "7402",
        wbs_code: null,
      },
    ],
  };
}
