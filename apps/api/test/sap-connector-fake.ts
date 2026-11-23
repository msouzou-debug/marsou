import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A fake of SAP administration's connector, in-process, on a free loopback
 * port (ADR-0036; the pattern of test/efinance-fake.ts).
 *
 * It answers the one route eCapital calls, `GET /v1/export/capexlines`, the
 * way the connector is ASSUMED to (see src/cost/source/sap-mcp.reader.ts):
 * the bearer key or 401, the export as CSV. `csv` and `status` are plain
 * fields the tests change between steps, and every call is recorded.
 *
 * The key below is a test value. It is not, and does not look like, a key
 * SAP administration issues.
 */
export const FAKE_SAP_KEY = "test-sap-connector-key-not-a-real-secret";

export interface FakeSapCall {
  path: string;
  query: Record<string, string>;
  authorization: string | undefined;
}

export class FakeSapConnector {
  csv = "";
  /** Answer this status instead of the CSV when set. */
  status: number | null = null;
  readonly calls: FakeSapCall[] = [];
  private server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const address = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    this.calls.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      authorization: req.headers.authorization,
    });
    if (req.method !== "GET" || url.pathname !== "/v1/export/capexlines") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${FAKE_SAP_KEY}`) {
      res.writeHead(401, { "Content-Type": "text/plain" }).end("unauthorised");
      return;
    }
    if (this.status !== null) {
      res.writeHead(this.status, { "Content-Type": "text/plain" }).end("failed");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" }).end(this.csv);
  }
}
