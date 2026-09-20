/**
 * The eArchive ingest contract, as the brief of 19/09/2026 states it.
 *
 * eArchive (formerly eMetroon) is ΟΚΥπΥ's protocol and records system.
 * Everything in this file is somebody else's decision, written down once so
 * that the builder, the sender and the samples in
 * `docs/integration/ecapital-dms-samples/` cannot drift apart: the MIME
 * whitelist, the limits, the closed vocabularies and the shape of the `meta`
 * part. `meta` is **strict** on eArchive's side — a field it does not know
 * makes the whole request a `400 SCHEMA_INVALID` — so it is strict here too,
 * and a mistake is a failed test rather than a refused upload.
 *
 * NO PATIENT DATA. Nothing below has a field that could hold one, and
 * `personal_data_category` is a closed list of four staff-and-money
 * categories with no clinical value in it. See ADR-0023.
 */
import { z } from "zod";

/** Loopback, same host as eArchive's other services (INTEGRATION §6). */
export const EARCHIVE_INGEST_PATH = "/api/v1/ingest/documents";

/** eArchive's limits. Enforced here so a refusal is ours and not a 413. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 200 * 1024 * 1024;
export const MAX_FILES = 20;

/**
 * The whitelist, verbatim: PDF, office documents, images, text, email.
 * No DWG and no ZIP — a drawing goes in as a PDF and a bundle goes in as its
 * files, because an archive that cannot read what it holds is a cupboard.
 */
export const MIME_WHITELIST = [
  "application/pdf",
  "text/html",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "message/rfc822",
  "application/vnd.ms-outlook",
] as const;

export type Mime = (typeof MIME_WHITELIST)[number];

export function isAllowedMime(mime: string): mime is Mime {
  return (MIME_WHITELIST as readonly string[]).includes(mime);
}

/**
 * eArchive's own categories, in its own spelling. Greek monotonic, and not
 * ours to reword: a category eArchive does not recognise is a refused
 * request, so this list is copied and never «improved».
 */
export const CATEGORIES = [
  "Προσλήψεις",
  "Προμήθειες",
  "Νομικά",
  "Οικονομικά",
  "Παράπονα",
  "Εγκύκλιοι",
  "Συμβάσεις",
  "Προσωπικό",
  "Ασφάλεια",
  "Δωρεές",
  "Ασθενείς",
  "Διοίκηση",
] as const;

/**
 * The four categories of personal data eArchive knows about. eCapital never
 * sends one: `personal_data` is false on every item it files, because an
 * award decision, a business case and a variation are about money, dates and
 * a company. The list is here so the schema can refuse a value that is not on
 * it if that ever changes. «Δεδομένα υγείας» is in eArchive's vocabulary and
 * is never in eCapital's — nothing in this system may produce it (ADR-0023).
 */
export const PERSONAL_DATA_CATEGORIES = [
  "Στοιχεία προσωπικού",
  "Στοιχεία ταυτοποίησης",
  "Δεδομένα υγείας",
  "Τραπεζικά στοιχεία",
] as const;

export const CLASSIFICATIONS = ["PUBLIC", "BUSINESS", "SENSITIVE", "HIGHLY_SENSITIVE"] as const;
export const DIRECTIONS = ["IN", "INTERNAL"] as const;
export const RELATIONS = ["RELATED", "REPLY_TO", "CONTINUES", "SUPERSEDES", "FULFILS"] as const;
export const SOURCE_MODULES = [
  "award",
  "business_case",
  "variation",
  "permit",
  "payment_cert",
  // M4 (R28): an asset's O&M manual, certificate, commissioning pack,
  // warranty, drawing or photo. ADR-0028.
  "asset_document",
] as const;

/** «ΤΥ, Αρχείο Τεχνικών Υπηρεσιών», numbering ΤΥ/2026/00001. */
export const REGISTRY_HINT = "ΤΥ";
/** Permanent, per the brief. */
export const RETENTION_CLASS_HINT = "rc-capital";
export const SOURCE_SYSTEM = "eCapital";
/** Who these papers come from, when they are ours. */
export const SENDER_TECHNICAL_SERVICES = "Τεχνικές Υπηρεσίες ΟΚΥπΥ";

/**
 * The twelve site codes. Since ADR-0024 these are exactly `org_unit.code`,
 * so nothing translates between the two — the list is here only so a bad
 * `folder_hints` entry fails a test rather than an upload. `CNS` was added
 * 20/09/2026 (ADR-0024's addendum): Community Nursing files under its own
 * eArchive folder now, not HQ's.
 */
export const SITE_CODES = [
  "HQ",
  "NGH",
  "NAM",
  "LGH",
  "LAR",
  "PAF",
  "FAM",
  "KYP",
  "POL",
  "MHS",
  "PHC",
  "CNS",
] as const;

const lowercaseHex64 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be lowercase hex");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
/** ISO 8601 **with offset** — eArchive refuses a naked local timestamp. */
const isoDateTimeWithOffset = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "ISO 8601 with an offset",
  );

export const DmsFile = z
  .object({
    kind: z.enum(["MAIN", "ATTACHMENT"]),
    /** The multipart field name this file's binary part carries. */
    part_name: z.string().min(1).max(60),
    filename: z.string().min(1).max(255),
    mime: z.enum(MIME_WHITELIST),
    size: z.number().int().positive().max(MAX_FILE_BYTES),
    sha256: lowercaseHex64,
  })
  .strict();
export type DmsFile = z.infer<typeof DmsFile>;

export const DmsFolderHint = z
  .object({ hospital: z.enum(SITE_CODES), title: z.string().min(1).max(200).optional() })
  .strict();

export const DmsCounterparty = z
  .object({
    type: z.enum(["vendor", "employee"]),
    code: z.string().min(1).max(60),
    name: z.string().min(1).max(200),
    vat: z.string().min(1).max(40).optional(),
  })
  .strict();

export const DmsRelated = z
  .object({ source_ref: z.string().min(1).max(120), relation: z.enum(RELATIONS) })
  .strict();

export const DmsApproval = z
  .object({
    actor_name: z.string().min(1).max(200),
    role: z.string().min(1).max(80),
    action: z.string().min(1).max(80),
    at: isoDateTimeWithOffset,
    comment: z.string().min(1).max(2000).optional(),
  })
  .strict();

/**
 * Everything about the item itself: what eCapital knows when it queues it.
 * `outbox_id` and `sent_at` are facts about the *sending* and are not in
 * here — the sender adds them when it builds the request, because `sent_at`
 * is the moment the request leaves and an item can wait in the queue for a
 * week before that happens (ADR-0023).
 */
export const DmsMetaBody = z
  .object({
    schema_version: z.literal(1),
    source_system: z.literal(SOURCE_SYSTEM),
    source_module: z.enum(SOURCE_MODULES).refine((m) => m.length <= 40),
    source_ref: z.string().min(1).max(120),
    source_url: z.string().min(1).max(500),
    doc_type: z.string().min(1).max(60),
    subject: z.string().min(3).max(500),
    direction: z.enum(DIRECTIONS),
    registry_hint: z.literal(REGISTRY_HINT),
    sender_name: z.string().min(1).max(200),
    sender_ref: z.string().min(1).max(120).optional(),
    letter_date: isoDate,
    event_date: isoDate.optional(),
    category: z.enum(CATEGORIES),
    classification: z.enum(CLASSIFICATIONS),
    personal_data: z.boolean(),
    personal_data_category: z.enum(PERSONAL_DATA_CATEGORIES).optional(),
    retention_class_hint: z.literal(RETENTION_CLASS_HINT),
    folder_hints: z.array(DmsFolderHint).min(1).max(5),
    counterparties: z.array(DmsCounterparty).max(20),
    /** A JSON number, not a string — the brief is explicit about this. */
    amount: z.number().nonnegative(),
    currency: z.literal("EUR"),
    related: z.array(DmsRelated).max(20),
    approvals: z.array(DmsApproval).max(20),
    files: z.array(DmsFile).min(1).max(MAX_FILES),
  })
  .strict()
  .superRefine((meta, ctx) => {
    if (meta.personal_data && !meta.personal_data_category) {
      ctx.addIssue({
        code: "custom",
        path: ["personal_data_category"],
        message: "personal_data is true, so a category is required",
      });
    }
    if (!meta.personal_data && meta.personal_data_category) {
      ctx.addIssue({
        code: "custom",
        path: ["personal_data_category"],
        message: "personal_data is false, so there is no category to send",
      });
    }
    const mains = meta.files.filter((f) => f.kind === "MAIN");
    if (mains.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: "exactly one file is the MAIN one",
      });
    }
    const partNames = new Set(meta.files.map((f) => f.part_name));
    if (partNames.size !== meta.files.length) {
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: "every file needs its own multipart part name",
      });
    }
    const total = meta.files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_REQUEST_BYTES) {
      ctx.addIssue({ code: "custom", path: ["files"], message: "over 200 MB in one request" });
    }
  });
export type DmsMetaBody = z.infer<typeof DmsMetaBody>;

/** The `meta` part as it goes on the wire: the body plus the two send facts. */
export const DmsMeta = z.intersection(
  DmsMetaBody,
  z.object({ outbox_id: z.string().min(1).max(120), sent_at: isoDateTimeWithOffset }),
);
export type DmsMeta = DmsMetaBody & { outbox_id: string; sent_at: string };

/**
 * eArchive's answer to a successful ingest. eCapital keeps `protocol_id` and
 * `protocol_number` and nothing else: the url and the registry are eArchive's
 * to serve, and the received_at is eArchive's clock (INTEGRATION §6).
 */
export const DmsIngestResponse = z.object({
  protocol_id: z.union([z.string(), z.number()]).transform(String),
  protocol_number: z.string().min(1),
  url: z.string().optional(),
  registry: z.string().optional(),
  received_at: z.string().optional(),
});
export type DmsIngestResponse = z.infer<typeof DmsIngestResponse>;

/**
 * The codes eArchive answers a refusal with. Every one of them means «do not
 * send this again»: the document is wrong, the token is wrong or the caller
 * is wrong, and none of those get better by waiting (ADR-0023).
 */
export const PERMANENT_ERROR_CODES = [
  "IDEMPOTENCY_MISMATCH",
  "DUPLICATE_SOURCE_REF",
  "SCHEMA_INVALID",
  "SHA256_MISMATCH",
  "UNKNOWN_REGISTRY",
  "UNAUTHORIZED",
  "LOOPBACK_ONLY",
  "SERVICE_ONLY",
  "SOURCE_MISMATCH",
  "PAYLOAD_TOO_LARGE",
  "MIME_REJECTED",
] as const;

/**
 * 1 minute, 5, 15, 60, then hourly — never dropped. The index is the number
 * of attempts already made, so the first retry waits a minute.
 */
export const BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export function backoffMinutes(attempts: number): number {
  if (attempts < 1) return BACKOFF_MINUTES[0];
  return BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
}

/**
 * The public-edge headers a loopback request has no business carrying
 * (ADR-0022, pointed inwards this time). eArchive refuses eCapital's calls
 * over these and eCapital refuses eArchive's callbacks over them.
 */
export const FORWARDED_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "cf-connecting-ip",
  "cf-ray",
] as const;

/**
 * Money in free text — a subject line, an approval comment — is written the
 * way eFinance writes it and the way the errata of 19/09/2026 settled for
 * every screen: «1.234,56 €».
 */
export function moneyInText(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const [whole, fraction] = Math.abs(rounded).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${rounded < 0 ? "-" : ""}${grouped},${fraction} €`;
}

/** ISO 8601 with the offset eArchive insists on, from a Date. */
export function isoWithOffset(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
