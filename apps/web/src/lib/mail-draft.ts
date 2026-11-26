// Owner request 26/11/2026 («attach e-mail/letter document and save, or send
// e-mail directly»), for the RFI and the site instruction alike.
//
// eCapital has no outgoing mail server, so nothing is sent from here. There
// are two ways to hand a written message to the engineer's Outlook:
//
// - `mailtoHref` — a `mailto:` link (RFC 6068). It opens a new message with
//   the recipient, subject and body, but a link cannot carry a file.
// - `buildEml` / `emlBlob` — an Outlook draft as a file: an RFC 5322 message,
//   MIME multipart with the files as base64 parts, `X-Unsent: 1` and no
//   `From`. Classic Outlook opens a downloaded .eml with `X-Unsent: 1` as a
//   new, editable message from the user's own mailbox; the user presses
//   «Αποστολή» there. Built in the browser from the `File` objects just
//   picked, so no byte goes anywhere but the user's disk.
//
// RULES (RFC 5322, RFC 2045–2047, RFC 2231):
// - CRLF line endings throughout; no line longer than 998 octets, and every
//   header line kept under 78 where it can be.
// - A header with anything but printable ASCII is written as RFC 2047
//   encoded-words (`=?UTF-8?B?…?=`), each at most 75 characters, split on a
//   character boundary and folded onto continuation lines.
// - An attachment's name is given twice: RFC 2231 (`filename*0*=UTF-8''…`,
//   in continuations) and RFC 2047 in `name=` / `filename=`, because classic
//   Outlook reads the second and standards-minded readers the first. Greek
//   file names survive both.
// - The body is UTF-8, base64, and every base64 part is wrapped at 76.
// - A .eml attached to the draft goes as application/octet-stream:
//   RFC 2046 forbids base64 on message/rfc822, and its extension is what
//   Outlook opens it by.

export interface MailDraft {
  to: string;
  subject: string;
  body: string;
}

export const ELLIPSIS = "…";
const CRLF = "\r\n";
/** RFC 2045 §6.8: base64 lines of at most 76 characters. 57 bytes make 76. */
const BASE64_LINE_BYTES = 57;
/** RFC 2047 §2: an encoded-word is at most 75 characters. */
const ENCODED_WORD_MAX = 75;
/** RFC 2231 continuation chunks, kept short so every line stays under 78. */
const RFC2231_CHUNK = 60;

/** Cut `text` to `limit` characters, ending in «…» when it was cut. */
export function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}${ELLIPSIS}`;
}

/** The first line of `text`, on one line and cut to `limit`, for a subject. */
export function firstLine(text: string, limit: number): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return shorten(line.replace(/\s+/g, " "), limit);
}

/**
 * RFC 6068. Everything is percent-encoded but the `@` of the address, which
 * some mail programs do not decode in the address part.
 */
export function mailtoHref(mail: MailDraft): string {
  const to = encodeURIComponent(mail.to).replace(/%40/g, "@");
  return `mailto:${to}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
}

// --------------------------------------------------------------- base64 --

const utf8 = new TextEncoder();

/** Base64 of `bytes`, in 76-character lines joined by CRLF. */
export function base64Lines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  // A block that is a whole number of lines, so each block's base64 splits
  // into whole lines and never needs padding in the middle.
  const block = BASE64_LINE_BYTES * 512;
  for (let start = 0; start < bytes.length; start += block) {
    const chunk = bytes.subarray(start, Math.min(bytes.length, start + block));
    let binary = "";
    for (let i = 0; i < chunk.length; i += 0x8000) {
      binary += String.fromCharCode(...chunk.subarray(i, i + 0x8000));
    }
    const encoded = btoa(binary);
    for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  }
  return lines;
}

function base64OfText(text: string): string {
  return base64Lines(utf8.encode(text)).join("");
}

// --------------------------------------------------------------- headers --

// Printable ASCII, no `=?` that a reader could take for an encoded-word.
function isPlainAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text) && !text.includes("=?");
}

/**
 * RFC 2047 B-encoded words for `text`, each at most 75 characters, split
 * between characters (never inside a UTF-8 sequence or a surrogate pair).
 */
export function encodedWords(text: string): string[] {
  const words: string[] = [];
  const prefix = "=?UTF-8?B?";
  const suffix = "?=";
  // 75 − 12 = 63 base64 characters, so at most 45 bytes a word (15 × 3).
  const maxBytes = Math.floor((ENCODED_WORD_MAX - prefix.length - suffix.length) / 4) * 3;
  let current = "";
  let currentBytes = 0;
  for (const char of text) {
    const size = utf8.encode(char).length;
    if (currentBytes + size > maxBytes && current) {
      words.push(`${prefix}${base64OfText(current)}${suffix}`);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  if (current || words.length === 0) words.push(`${prefix}${base64OfText(current)}${suffix}`);
  return words;
}

/** One header, encoded when it must be and folded onto continuation lines. */
function header(name: string, value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  if (isPlainAscii(clean) && name.length + 2 + clean.length <= 78) return `${name}: ${clean}`;
  if (isPlainAscii(clean)) return `${name}: ${foldAscii(clean, name.length + 2)}`;
  return `${name}: ${encodedWords(clean).join(`${CRLF} `)}`;
}

/** Fold plain ASCII at spaces so that lines stay under 78 where they can. */
function foldAscii(text: string, firstIndent: number): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  let room = 78 - firstIndent;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > room && line) {
      lines.push(line);
      line = word;
      room = 77;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines.join(`${CRLF} `);
}

/** RFC 2231 §3–4: `filename*0*=UTF-8''…; filename*1*=…`, percent-encoded. */
function rfc2231(param: string, value: string): string[] {
  const encoded = Array.from(utf8.encode(value), (byte) => {
    const char = String.fromCharCode(byte);
    // attribute-char: ASCII letters, digits and a few marks; the rest as %XX.
    return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
  const chunks: string[] = [];
  // Never split a %XX escape across two chunks.
  let start = 0;
  while (start < encoded.length) {
    let end = Math.min(encoded.length, start + RFC2231_CHUNK);
    const percent = encoded.lastIndexOf("%", end - 1);
    if (percent > end - 3 && percent >= start && end < encoded.length) end = percent;
    chunks.push(encoded.slice(start, end));
    start = end;
  }
  if (chunks.length === 0) chunks.push("");
  return chunks.map((chunk, i) => `${param}*${i}*=${i === 0 ? "UTF-8''" : ""}${chunk}`);
}

/** A quoted parameter: plain when it can be, RFC 2047 words when it cannot. */
function quotedParam(param: string, value: string): string {
  if (isPlainAscii(value) && !/["\\]/.test(value)) return `${param}="${value}"`;
  return `${param}="${encodedWords(value).join(`${CRLF} `)}"`;
}

// ------------------------------------------------------------ the message --

export interface EmlAttachment {
  filename: string;
  /** The file's own type; empty when the browser did not know. */
  mime: string;
  bytes: Uint8Array;
}

export interface EmlOptions {
  /** Fixed in tests; random otherwise. */
  boundary?: string;
  /** Fixed in tests; now otherwise. Outlook replaces it when the draft is sent. */
  date?: Date;
}

/** The type an attachment travels under in the draft. */
export function attachmentMime(filename: string, declared: string): string {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(filename.trim())?.[1]?.toLowerCase();
  if (extension === "msg") return "application/vnd.ms-outlook";
  // RFC 2046 §5.2.1: no base64 on message/rfc822. Outlook opens it by name.
  if (extension === "eml") return "application/octet-stream";
  const type = declared.trim().toLowerCase();
  if (!type || type === "message/rfc822" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) {
    return "application/octet-stream";
  }
  return type;
}

function randomBoundary(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `----=_eCapital_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** RFC 5322 §3.3 date-time, in UTC. */
function rfc5322Date(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const two = (n: number) => String(n).padStart(2, "0");
  return `${days[date.getUTCDay()]}, ${two(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} +0000`;
}

/**
 * The draft, as the lines of an .eml file (CRLF between them). Returned as
 * parts rather than one string so a large attachment is not copied twice.
 */
export function buildEmlParts(mail: MailDraft, attachments: EmlAttachment[], options: EmlOptions = {}): string[] {
  const boundary = options.boundary ?? randomBoundary();
  const body = mail.body.replace(/\r?\n/g, CRLF);
  const head = [
    "MIME-Version: 1.0",
    // Outlook opens the file as a new message to edit and send, not as a
    // received one. No From: Outlook fills in the user's own address.
    "X-Unsent: 1",
    `Date: ${rfc5322Date(options.date ?? new Date())}`,
    header("To", mail.to.trim()),
    header("Subject", mail.subject),
  ];
  const textPart = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...base64Lines(utf8.encode(body)),
  ];

  if (attachments.length === 0) {
    return [...head, ...textPart].map((line) => `${line}${CRLF}`);
  }

  const lines: string[] = [
    ...head,
    `Content-Type: multipart/mixed;${CRLF} boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
    `--${boundary}`,
    ...textPart,
  ];
  for (const file of attachments) {
    const name = file.filename.replace(/[\r\n]+/g, "_").replace(/["\\]/g, "_") || "attachment";
    const type = attachmentMime(name, file.mime);
    lines.push(
      `--${boundary}`,
      `Content-Type: ${type};${CRLF} ${quotedParam("name", name)}`,
      "Content-Transfer-Encoding: base64",
      ["Content-Disposition: attachment", ...rfc2231("filename", name), quotedParam("filename", name)].join(
        `;${CRLF} `,
      ),
      "",
      ...base64Lines(file.bytes),
    );
  }
  lines.push(`--${boundary}--`);
  return lines.map((line) => `${line}${CRLF}`);
}

export function buildEml(mail: MailDraft, attachments: EmlAttachment[], options: EmlOptions = {}): string {
  return buildEmlParts(mail, attachments, options).join("");
}

/** A file's bytes; FileReader where `Blob.arrayBuffer` is missing (older engines, jsdom). */
export function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** The draft as a file, from the `File`s the user just picked. */
export async function emlBlob(mail: MailDraft, files: File[], options: EmlOptions = {}): Promise<Blob> {
  const attachments = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      mime: file.type,
      bytes: await readBytes(file),
    })),
  );
  return new Blob(buildEmlParts(mail, attachments, options), { type: "message/rfc822" });
}

/** Hand `blob` to the browser as a download called `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
