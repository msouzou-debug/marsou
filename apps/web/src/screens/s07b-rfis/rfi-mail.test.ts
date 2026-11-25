import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import el from "@/i18n/el.json";
import { MAILTO_BODY_LIMIT, buildRfiMail, mailtoHref, shortQuestion, type RfiMailTranslate } from "./rfi-mail";

const translate = createTranslator({ locale: "el", messages: el, namespace: "screens.s07b.email" });
const t: RfiMailTranslate = (key, values) => translate(key, values);

const facts = {
  number: 2,
  questionEl: "Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;",
  recipientEmail: "m.andreou@architects.example",
  slaDueAt: "2026-09-23T09:00:00.000Z",
  contractNo: "ΤΥ/2026/001",
  contractorName: "Δοκιμαστική Εργοληπτική Λτδ",
  projectCode: "PRJ-014",
  projectTitle: "Ανακαίνιση θαλάμου Α1",
};

// Owner UAT 25/11/2026: «The RFI should go through e-mail.»
describe("buildRfiMail", () => {
  it("addresses the recipient, with «number — contract — short question» as the subject", () => {
    const mail = buildRfiMail(facts, t);
    expect(mail.to).toBe("m.andreou@architects.example");
    expect(mail.subject).toBe(
      "Αίτημα διευκρίνισης 2 — ΤΥ/2026/001 — Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;",
    );
  });

  it("writes the question, the due date as dd/mm/yyyy, the contract and project, and asks for the number in the reply", () => {
    const { body } = buildRfiMail(facts, t);
    expect(body.split("\r\n")).toEqual([
      "Αίτημα διευκρίνισης 2",
      "Σύμβαση: ΤΥ/2026/001, Δοκιμαστική Εργοληπτική Λτδ",
      "Έργο: PRJ-014 — Ανακαίνιση θαλάμου Α1",
      "Προθεσμία απάντησης: 23/09/2026",
      "",
      "Ερώτηση:",
      "Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;",
      "",
      "Στην απάντησή σας αναφέρετε τον αριθμό «Αίτημα διευκρίνισης 2» και τη σύμβαση ΤΥ/2026/001.",
    ]);
  });

  it("leaves the project line out when there is none", () => {
    const { body } = buildRfiMail({ ...facts, projectCode: null, projectTitle: null }, t);
    expect(body).not.toContain("Έργο:");
  });

  it("shortens a long question with «…» and keeps the reply line", () => {
    const long = "Α".repeat(5000);
    const { body, subject } = buildRfiMail({ ...facts, questionEl: long }, t);
    expect(body.length).toBeLessThanOrEqual(MAILTO_BODY_LIMIT);
    expect(body).toContain("Α…");
    expect(body.endsWith("και τη σύμβαση ΤΥ/2026/001.")).toBe(true);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("keeps a question that fits untouched", () => {
    const { body } = buildRfiMail(facts, t);
    expect(body).not.toContain("…");
  });
});

describe("shortQuestion", () => {
  it("takes the first line, on one line", () => {
    expect(shortQuestion("Πρώτη   γραμμή\nδεύτερη")).toBe("Πρώτη γραμμή");
  });
});

describe("mailtoHref", () => {
  it("encodes subject and body, line breaks as %0D%0A, and leaves the address readable", () => {
    const href = mailtoHref(buildRfiMail(facts, t));
    expect(href.startsWith("mailto:m.andreou@architects.example?subject=")).toBe(true);
    expect(href).toContain("%0D%0A");
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe(
      "Αίτημα διευκρίνισης 2 — ΤΥ/2026/001 — Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;",
    );
    expect(url.searchParams.get("body")).toContain("Προθεσμία απάντησης: 23/09/2026");
  });

  it("cannot be broken out of by a question with & or ?", () => {
    const href = mailtoHref(buildRfiMail({ ...facts, questionEl: "Α & Β; ή Γ? body=x" }, t));
    const url = new URL(href);
    expect(url.searchParams.get("body")).toContain("Α & Β; ή Γ? body=x");
    expect([...url.searchParams.keys()]).toEqual(["subject", "body"]);
  });
});
