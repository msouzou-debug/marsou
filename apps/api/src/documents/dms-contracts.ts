/**
 * What the document and eArchive routes answer with. Zod, because the
 * OpenAPI document is built from these and a second description of the same
 * shape would drift within a milestone (see src/common/openapi.ts).
 */
import { z } from "zod";
import { SOURCE_MODULES } from "./earchive-contract";

export const DocumentRecord = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  orgUnitId: z.string(),
  kind: z.enum([
    "AWARD_DECISION",
    "BUSINESS_CASE",
    "VARIATION",
    "PERMIT",
    "PAYMENT_CERT",
    "OTHER",
    // M4 (R28): an asset's manual, certificate, commissioning pack, warranty,
    // drawing or photograph.
    "ASSET_DOCUMENT",
  ]),
  titleEl: z.string(),
  filename: z.string(),
  mime: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  version: z.number().int(),
  /** The eArchive key this item was filed under. */
  sourceRef: z.string().nullable(),
  /** Null until eArchive has answered; eCapital never invents a number. */
  protocolId: z.string().nullable(),
  protocolNumber: z.string().nullable(),
  /** eArchive put a hold on it; nothing local may treat it as disposable. */
  legalHold: z.boolean(),
  /** eArchive deleted the protocol. The row is the tombstone. */
  deletedAt: z.string().nullable(),
  /** QUEUED while the token is not configured — the «hold» rule of ADR-0023. */
  outboxStatus: z
    .enum(["QUEUED", "SENDING", "SENT", "FAILED", "HELD"])
    .nullable(),
  createdAt: z.string(),
});
export type DocumentRecord = z.infer<typeof DocumentRecord>;

export const DmsOutboxItem = z.object({
  id: z.string(),
  sourceRef: z.string(),
  sourceModule: z.enum(SOURCE_MODULES),
  status: z.enum(["QUEUED", "SENDING", "SENT", "FAILED", "HELD"]),
  attempts: z.number().int(),
  nextAttemptAt: z.string(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  protocolId: z.string().nullable(),
  protocolNumber: z.string().nullable(),
  orgUnitId: z.string().nullable(),
  subject: z.string(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type DmsOutboxItem = z.infer<typeof DmsOutboxItem>;

export const DmsOutboxList = z.object({
  items: z.array(DmsOutboxItem),
  total: z.number().int(),
  /** True when EARCHIVE_URL and ECAPITAL_INGEST_TOKEN are both configured. */
  senderConfigured: z.boolean(),
});
export type DmsOutboxList = z.infer<typeof DmsOutboxList>;

export const DmsOutboxQuery = z.object({
  status: z.enum(["QUEUED", "SENDING", "SENT", "FAILED", "HELD"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DmsOutboxQuery = z.infer<typeof DmsOutboxQuery>;

/**
 * eArchive's callback body. `at` is eArchive's clock, ISO 8601; the rest is
 * the protocol it is telling us about.
 */
export const DmsEventBody = z.object({
  event: z.enum(["protocol.deleted", "legal_hold.set", "legal_hold.cleared"]),
  protocol_id: z.union([z.string().min(1), z.number()]).transform(String),
  protocol_number: z.string().min(1).max(120).optional(),
  source_ref: z.string().min(1).max(120).optional(),
  at: z.string().min(1).max(60),
});
export type DmsEventBody = z.infer<typeof DmsEventBody>;

export const DmsEventAck = z.object({
  /** True when this call is the one that recorded it, false on a replay. */
  recorded: z.boolean(),
});
export type DmsEventAck = z.infer<typeof DmsEventAck>;
