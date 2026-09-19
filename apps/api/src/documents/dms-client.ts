/**
 * Talking to eArchive.
 *
 * Two implementations behind one interface. `EArchiveClient` is the real one:
 * a loopback `fetch` to `EARCHIVE_URL`, no proxy, with the multipart body
 * built to the exact part names `meta.files[].part_name` promised.
 * `NullClient` is what the API uses when `EARCHIVE_URL` or
 * `ECAPITAL_INGEST_TOKEN` is not configured — it says «not configured» and
 * the item stays QUEUED, which is ADR-0023's «hold until Marios places the
 * token» rule written as code rather than as a warning in a runbook.
 *
 * Nothing here retries. The client says what happened; the sender decides
 * whether that is a refusal to record or a delay to wait out.
 */
import { Inject, Injectable } from "@nestjs/common";
import { CONFIG, type AppConfig } from "../config";
import {
  type DmsFile,
  type DmsMeta,
  DmsIngestResponse,
  EARCHIVE_INGEST_PATH,
  MAX_REQUEST_BYTES,
} from "./earchive-contract";

export interface SendPart {
  file: DmsFile;
  bytes: Buffer;
}

export interface SendRequest {
  outboxId: string;
  meta: DmsMeta;
  parts: SendPart[];
}

export type SendResult =
  | { outcome: "sent"; protocolId: string; protocolNumber: string; replayed: boolean }
  /** eArchive refused it and said why. Never retried (ADR-0023). */
  | { outcome: "refused"; code: string; message: string }
  /** eArchive is not there, or not well. Retried with backoff, never dropped. */
  | { outcome: "unavailable"; code: string; message: string }
  /** No URL, no token: the queue holds until somebody places them. */
  | { outcome: "not-configured"; code: string; message: string };

export interface DmsClient {
  readonly configured: boolean;
  send(request: SendRequest): Promise<SendResult>;
}

export const DMS_CLIENT = Symbol("ecapital.dmsClient");

/**
 * The hold. An item is not failed, not dropped and not sent anywhere else —
 * it waits, and the moment the token is in `/etc/ecapital/api.env` and the
 * unit is restarted, the queue drains in order.
 */
@Injectable()
export class NullClient implements DmsClient {
  readonly configured = false;

  send(): Promise<SendResult> {
    return Promise.resolve({
      outcome: "not-configured",
      code: "NOT_CONFIGURED",
      message:
        "EARCHIVE_URL or ECAPITAL_INGEST_TOKEN is not set, so nothing is sent and the queue holds.",
    });
  }
}

@Injectable()
export class EArchiveClient implements DmsClient {
  readonly configured: boolean;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.baseUrl = (config.EARCHIVE_URL ?? "").replace(/\/+$/, "");
    this.token = config.ECAPITAL_INGEST_TOKEN ?? "";
    this.timeoutMs = config.EARCHIVE_TIMEOUT_MS;
    this.configured = Boolean(this.baseUrl && this.token);
  }

  /**
   * One `POST /api/v1/ingest/documents`, `multipart/form-data`, with one text
   * part `meta` and one binary part per `meta.files[]` whose field name is
   * that file's `part_name`.
   *
   * RULE (eArchive brief): `Idempotency-Key: ecapital:<outbox_id>`. A retry
   * after a dropped connection is answered `200` with `Idempotency-Replayed:
   * true` and the same protocol, which is why the sender can retry an item
   * it is not sure landed.
   *
   * RULE (ADR-0022): a loopback call carries no public-edge header and goes
   * through no proxy. `NO_PROXY=127.0.0.1,localhost` on the systemd unit is
   * what keeps Squid out of it; the request is built from scratch here and
   * never forwards a header it received on an unrelated inbound request.
   */
  async send(request: SendRequest): Promise<SendResult> {
    if (!this.configured) {
      return {
        outcome: "not-configured",
        code: "NOT_CONFIGURED",
        message: "EARCHIVE_URL or ECAPITAL_INGEST_TOKEN is not set.",
      };
    }

    const total = request.parts.reduce((sum, p) => sum + p.bytes.length, 0);
    if (total > MAX_REQUEST_BYTES) {
      return {
        outcome: "refused",
        code: "PAYLOAD_TOO_LARGE",
        message: `${total} bytes is over eArchive's 200 MB limit for one request.`,
      };
    }

    const form = new FormData();
    form.append("meta", JSON.stringify(request.meta));
    for (const part of request.parts) {
      form.append(
        part.file.part_name,
        new Blob([new Uint8Array(part.bytes)], { type: part.file.mime }),
        part.file.filename,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${EARCHIVE_INGEST_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Idempotency-Key": `ecapital:${request.outboxId}`,
          Accept: "application/json",
        },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      // Connection refused, DNS, a timeout: eArchive is not answering. That
      // is a delay, not a refusal, and the sender waits it out.
      return {
        outcome: "unavailable",
        code: "CONNECTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    const body = parseJson(text);

    if (response.status === 201 || response.status === 200) {
      const parsed = DmsIngestResponse.safeParse(body);
      if (!parsed.success) {
        // A 2xx whose body we cannot read is worse than a 5xx: we do not know
        // whether it landed. Retrying is safe because of the idempotency key.
        return {
          outcome: "unavailable",
          code: "RESPONSE_UNREADABLE",
          message: `eArchive answered ${response.status} with a body this client cannot read.`,
        };
      }
      return {
        outcome: "sent",
        protocolId: parsed.data.protocol_id,
        protocolNumber: parsed.data.protocol_number,
        replayed: response.headers.get("Idempotency-Replayed") === "true",
      };
    }

    if (response.status >= 500) {
      return {
        outcome: "unavailable",
        code: `HTTP_${response.status}`,
        message: shorten(text),
      };
    }

    // 4xx: eArchive has looked at it and said no. The code it gives is the
    // one an administrator needs, so it is kept verbatim.
    return {
      outcome: "refused",
      code: codeOf(body) ?? `HTTP_${response.status}`,
      message: shorten(text),
    };
  }
}

function parseJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

/** `{"error":{"code":…}}`, `{"code":…}` — eArchive's shape is not settled. */
function codeOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  const error = record.error;
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function shorten(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}
