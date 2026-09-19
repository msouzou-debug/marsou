/**
 * Where the bytes live until eArchive has them.
 *
 * eCapital is not an archive and this is not a document management system
 * (INTEGRATION §6, ADR-0023): the only reason a file is on this disk at all
 * is that a multipart upload to eArchive needs bytes in hand, and a queue
 * that retries for an hour needs them still to be there on the fourth
 * attempt. Everything about the store is therefore deliberately small — put,
 * get, and a delete nothing calls yet.
 *
 * The interface exists so that the one implementation today, a directory on
 * the server, is not the only one possible tomorrow. `DOCUMENT_STORE_DIR` is
 * `./var/documents` in development and `/var/lib/ecapital/documents` on the
 * ΟΚΥπΥ server (deploy/env/api.env.example, RUNBOOK §11).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "../common/errors";
import { CONFIG, type AppConfig } from "../config";
import { MAX_FILE_BYTES, isAllowedMime } from "./earchive-contract";

export interface PutInput {
  /** The bytes. Hashed on the way in; the hash is what eArchive checks. */
  bytes: Buffer;
  filename: string;
  mime: string;
  /** A folder inside the store, e.g. `award/<contract id>`. */
  prefix: string;
}

export interface StoredObject {
  objectKey: string;
  sha256: string;
  size: number;
  mime: string;
  filename: string;
}

export interface ObjectStore {
  put(input: PutInput): Promise<StoredObject>;
  get(objectKey: string): Promise<Buffer>;
  remove(objectKey: string): Promise<void>;
}

export const OBJECT_STORE = Symbol("ecapital.objectStore");

/** `..`, a leading slash, a null byte: not a key, whoever produced it. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * A file name a person can read in a directory listing and a file system will
 * accept. The original name is kept in the database and in `meta.filename`;
 * this is only what the bytes are called on disk.
 */
export function safeFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length ? cleaned.slice(0, 120) : "document";
}

@Injectable()
export class LocalDiskObjectStore implements ObjectStore {
  private readonly root: string;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.root = resolve(config.DOCUMENT_STORE_DIR);
  }

  /**
   * RULE (eArchive brief): the MIME whitelist is enforced at upload, not at
   * send. A file eArchive would answer `415 MIME_REJECTED` for never reaches
   * the queue, so nobody has to find out an hour later that their drawing
   * was a DWG.
   *
   * The sha256 is computed here, over the bytes that are actually written,
   * because `size` and `sha256` in `meta.files[]` have to match the bytes —
   * a hash taken from anywhere else is a hash of something else.
   */
  async put(input: PutInput): Promise<StoredObject> {
    if (!isAllowedMime(input.mime)) throw AppError.unprocessable("errors.documentMimeRejected");
    if (input.bytes.length === 0) throw AppError.badRequest("errors.documentEmpty");
    if (input.bytes.length > MAX_FILE_BYTES) {
      throw AppError.unprocessable("errors.documentTooLarge");
    }

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const filename = safeFilename(input.filename);
    const objectKey = `${input.prefix}/${randomUUID()}/${filename}`;
    if (!SAFE_KEY.test(objectKey) || objectKey.includes("..")) {
      throw AppError.badRequest("errors.documentNameNotValid");
    }

    const path = this.pathOf(objectKey);
    await mkdir(dirname(path), { recursive: true, mode: 0o750 });
    await writeFile(path, input.bytes, { mode: 0o640 });

    return {
      objectKey,
      sha256,
      size: input.bytes.length,
      mime: input.mime,
      filename: input.filename.slice(0, 255),
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.pathOf(objectKey));
  }

  async remove(objectKey: string): Promise<void> {
    await rm(this.pathOf(objectKey), { force: true });
  }

  /**
   * The key is built here and read back here, but it also arrives from a
   * database row that a future migration or repair script wrote, so the way
   * out of the store is checked as carefully as the way in.
   */
  private pathOf(objectKey: string): string {
    if (!SAFE_KEY.test(objectKey) || objectKey.includes("..")) {
      throw AppError.badRequest("errors.documentNameNotValid");
    }
    const path = resolve(join(this.root, objectKey));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw AppError.badRequest("errors.documentNameNotValid");
    }
    return path;
  }
}
