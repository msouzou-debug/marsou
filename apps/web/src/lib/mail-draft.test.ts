import { describe, expect, it } from "vitest";
import {
  attachmentMime,
  base64Lines,
  buildEml,
  emlBlob,
  encodedWords,
  firstLine,
  mailtoHref,
  readBytes,
  shorten,
  type MailDraft,
} from "./mail-draft";

// Owner request 26/11/2026: «Αποθήκευση και αποστολή e-mail» downloads an
// Outlook draft with the letter attached. These tests read the .eml back the
// way a mail reader would — unfold the headers, decode RFC 2047 and RFC 2231,
// split the multipart, decode base64 — and check what comes out.

const CRLF = "\r\n";
const decoder = new TextDecoder();

function decodeWords(value: string): string {
  // Adjacent encoded-words separated only by folding whitespace join up (RFC 2047 §6.2).
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/g, (_, b64: string) => decoder.decode(Buffer.from(b64, "base64")));
}

interface Part {
  headers: Map<string, string>;
  raw: string;
  body: string;
}

function parsePart(text: string): Part {
  const split = text.indexOf(`${CRLF}${CRLF}`);
  const head = text.slice(0, split);
  const body = text.slice(split + 4);
  const headers = new Map<string, string>();
  // Unfold: CRLF followed by whitespace continues the previous line.
  for (const line of head.replace(/\r\n[ \t]/g, " ").split(CRLF)) {
    const colon = line.indexOf(":");
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, raw: head, body };
}

function param(header: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`).exec(header);
  return match?.[1];
}

/** RFC 2231: filename*0*=UTF-8''…; filename*1*=… */
function rfc2231Param(header: string, name: string): string {
  const chunks = [...header.matchAll(new RegExp(`${name}\\*(\\d+)\\*=([^;\\s]*)`, "g"))]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => m[2]);
  return decodeURIComponent(chunks.join("").replace(/^UTF-8''/, ""));
}

function parts(eml: string): { top: Part; children: Part[] } {
  const top = parsePart(eml);
  const boundary = param(top.headers.get("content-type") ?? "", "boundary");
  if (!boundary) return { top, children: [] };
  const sections = top.body.split(`--${boundary}`);
  // [preamble, part, part, …, "--" + epilogue]
  const children = sections
    .slice(1, -1)
    .map((section) => parsePart(section.replace(/^\r\n/, "").replace(/\r\n$/, "")));
  expect(sections[sections.length - 1].startsWith("--")).toBe(true);
  return { top, children };
}

function bodyBytes(part: Part): Buffer {
  return Buffer.from(part.body.replace(/\r\n/g, ""), "base64");
}

const mail: MailDraft = {
  to: "m.andreou@architects.example",
  subject: "Αίτημα διευκρίνισης 2 — ΤΥ/2026/001 — Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;",
  body: "Αίτημα διευκρίνισης 2\r\nΣύμβαση: ΤΥ/2026/001\r\n\r\nΕρώτηση:\r\nΠοιο πρότυπο ισχύει;",
};
const FIXED = { boundary: "----=_eCapital_test", date: new Date("2026-11-26T09:30:00Z") };

describe("buildEml — the Outlook draft", () => {
  it("is an unsent message with no From, To the recipient and the Greek subject in RFC 2047", () => {
    const eml = buildEml(mail, [], FIXED);
    const { top } = parts(eml);
    expect(top.headers.get("x-unsent")).toBe("1");
    expect(top.headers.has("from")).toBe(false);
    expect(top.headers.get("mime-version")).toBe("1.0");
    expect(top.headers.get("to")).toBe("m.andreou@architects.example");
    expect(top.headers.get("date")).toBe("Thu, 26 Nov 2026 09:30:00 +0000");
    expect(top.raw).toContain("=?UTF-8?B?");
    expect(decodeWords(top.headers.get("subject") ?? "")).toBe(mail.subject);
  });

  it("uses CRLF only, and no line over 998 octets nor a header line over 78 where it can be helped", () => {
    const eml = buildEml(mail, [{ filename: "Επιστολή προς τον ανάδοχο για τις πυράντοχες θύρες του θαλάμου Α1.pdf", mime: "application/pdf", bytes: new Uint8Array(5000).fill(65) }], FIXED);
    expect(eml.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const lines = eml.split(CRLF);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(998);
    // Every encoded-word is at most 75 characters (RFC 2047 §2).
    for (const word of eml.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? []) expect(word.length).toBeLessThanOrEqual(75);
    // Base64 lines at most 76 (RFC 2045 §6.8).
    const { children } = parts(eml);
    for (const part of children) {
      for (const line of part.body.split(CRLF)) expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  it("carries the body as UTF-8 base64, the same text and line breaks", () => {
    const { top } = parts(buildEml(mail, [], FIXED));
    expect(top.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
    expect(top.headers.get("content-transfer-encoding")).toBe("base64");
    expect(decoder.decode(bodyBytes(top))).toBe(mail.body);
  });

  it("turns bare LF line breaks in the body into CRLF", () => {
    const { top } = parts(buildEml({ ...mail, body: "α\nβ" }, [], FIXED));
    expect(decoder.decode(bodyBytes(top))).toBe("α\r\nβ");
  });

  it("attaches each file as a base64 part, byte for byte, with its Greek name in RFC 2231 and RFC 2047", () => {
    const pdf = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256));
    const msg = new TextEncoder().encode("Outlook bytes");
    const eml = buildEml(
      mail,
      [
        { filename: "Επιστολή αναδόχου 26-11.pdf", mime: "application/pdf", bytes: pdf },
        { filename: "sent.msg", mime: "", bytes: msg },
      ],
      FIXED,
    );
    const { top, children } = parts(eml);
    expect(top.headers.get("content-type")).toBe('multipart/mixed; boundary="----=_eCapital_test"');
    expect(children).toHaveLength(3);

    const [text, letter, outlook] = children;
    expect(text.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
    expect(decoder.decode(bodyBytes(text))).toBe(mail.body);

    expect(letter.headers.get("content-type")?.startsWith("application/pdf;")).toBe(true);
    expect(letter.headers.get("content-transfer-encoding")).toBe("base64");
    const disposition = letter.headers.get("content-disposition") ?? "";
    expect(disposition.startsWith("attachment;")).toBe(true);
    expect(rfc2231Param(disposition, "filename")).toBe("Επιστολή αναδόχου 26-11.pdf");
    expect(decodeWords(param(disposition, "filename") ?? "")).toBe("Επιστολή αναδόχου 26-11.pdf");
    expect(decodeWords(param(letter.headers.get("content-type") ?? "", "name") ?? "")).toBe("Επιστολή αναδόχου 26-11.pdf");
    expect(Buffer.compare(bodyBytes(letter), Buffer.from(pdf))).toBe(0);

    // A .msg the browser did not type goes as Outlook's own type.
    expect(outlook.headers.get("content-type")).toBe('application/vnd.ms-outlook; name="sent.msg"');
    expect(rfc2231Param(outlook.headers.get("content-disposition") ?? "", "filename")).toBe("sent.msg");
    expect(decoder.decode(bodyBytes(outlook))).toBe("Outlook bytes");
  });

  it("keeps a very long Greek file name whole across RFC 2231 continuations", () => {
    const name = `${"Αλληλογραφία ".repeat(15).trim()}.pdf`;
    const eml = buildEml(mail, [{ filename: name, mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }], FIXED);
    const disposition = parts(eml).children[1].headers.get("content-disposition") ?? "";
    expect(disposition).toContain("filename*1*=");
    expect(rfc2231Param(disposition, "filename")).toBe(name);
    expect(decodeWords(param(disposition, "filename") ?? "")).toBe(name);
  });

  it("makes a random boundary when none is given, and ends the multipart", () => {
    const eml = buildEml(mail, [{ filename: "a.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) }]);
    const boundary = param(parts(eml).top.headers.get("content-type") ?? "", "boundary");
    expect(boundary).toMatch(/^----=_eCapital_[0-9a-f]{24}$/);
    expect(eml.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it("cannot be broken by a subject or name with line breaks or quotes", () => {
    const eml = buildEml(
      { ...mail, subject: "Α\r\nBcc: someone@example.com" },
      [{ filename: 'x"\r\ny.pdf', mime: "application/pdf", bytes: new Uint8Array([1]) }],
      FIXED,
    );
    const { top, children } = parts(eml);
    expect(top.headers.has("bcc")).toBe(false);
    expect(decodeWords(top.headers.get("subject") ?? "")).toBe("Α Bcc: someone@example.com");
    expect(rfc2231Param(children[1].headers.get("content-disposition") ?? "", "filename")).toBe("x__y.pdf");
  });

  it("builds the same draft from browser File objects, as a message/rfc822 Blob", async () => {
    const file = new File([new Uint8Array([0, 255, 10, 13])], "Επιστολή.pdf", { type: "application/pdf" });
    const blob = await emlBlob(mail, [file], FIXED);
    expect(blob.type).toBe("message/rfc822");
    const text = decoder.decode(await readBytes(blob));
    const attached = parts(text).children[1];
    expect(rfc2231Param(attached.headers.get("content-disposition") ?? "", "filename")).toBe("Επιστολή.pdf");
    expect([...bodyBytes(attached)]).toEqual([0, 255, 10, 13]);
  });
});

describe("attachmentMime", () => {
  it("files .msg as Outlook, sends .eml and unknown types as octet-stream, keeps a sane declared type", () => {
    expect(attachmentMime("a.MSG", "")).toBe("application/vnd.ms-outlook");
    expect(attachmentMime("a.eml", "message/rfc822")).toBe("application/octet-stream");
    expect(attachmentMime("a.bin", "")).toBe("application/octet-stream");
    expect(attachmentMime("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(attachmentMime("a.pdf", "text/html; charset=x")).toBe("application/octet-stream");
  });
});

describe("encodedWords", () => {
  it("never splits a Greek letter or an emoji between two words", () => {
    const text = "Ωραία 😀 ".repeat(20);
    const words = encodedWords(text);
    expect(words.length).toBeGreaterThan(1);
    expect(decodeWords(words.join(" "))).toBe(text);
  });
});

describe("base64Lines", () => {
  it("wraps at 76 and decodes back across the internal blocks", () => {
    const bytes = new Uint8Array(57 * 512 * 2 + 10).map((_, i) => (i * 7) % 256);
    const lines = base64Lines(bytes);
    expect(lines.slice(0, -1).every((line) => line.length === 76)).toBe(true);
    expect(Buffer.compare(Buffer.from(lines.join(""), "base64"), Buffer.from(bytes))).toBe(0);
  });
});

describe("mailtoHref", () => {
  it("encodes subject and body, line breaks as %0D%0A, and leaves the address readable", () => {
    const href = mailtoHref(mail);
    expect(href.startsWith("mailto:m.andreou@architects.example?subject=")).toBe(true);
    expect(href).toContain("%0D%0A");
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe(mail.subject);
  });
});

describe("shorten / firstLine", () => {
  it("cuts with «…» and takes the first line on one line", () => {
    expect(shorten("αβγδε", 3)).toBe("αβ…");
    expect(shorten("αβ", 3)).toBe("αβ");
    expect(firstLine("Πρώτη   γραμμή\nδεύτερη", 60)).toBe("Πρώτη γραμμή");
  });
});
