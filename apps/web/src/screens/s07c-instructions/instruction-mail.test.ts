import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import el from "@/i18n/el.json";
import { MAILTO_BODY_LIMIT } from "@/screens/s07b-rfis/rfi-mail";
import { buildInstructionMail, instructionEmlFilename, type InstructionMailTranslate } from "./instruction-mail";

const translate = createTranslator({ locale: "el", messages: el, namespace: "screens.s07c.email", timeZone: "Europe/Nicosia" });
const t: InstructionMailTranslate = (key, values) => translate(key, values);

const facts = {
  number: 5,
  textEl: "Κλείστε την πρόσβαση στον διάδρομο Β\nμέχρι την Παρασκευή.",
  recipientEmail: " m.andreou@contractor.example ",
  issuedAt: "2026-11-24T10:00:00.000Z",
  contractNo: "ΤΥ/2026/031",
  contractorName: "Κυριάκου Τεχνικές Κατασκευές Λτδ",
  projectCode: "LAR-2026-031",
  projectTitle: "Αντικατάσταση ακτινολογικού εξοπλισμού",
};

// Owner request 26/11/2026: «site instructions need same facility to send e-mails as RFI».
describe("buildInstructionMail", () => {
  it("addresses the recipient with «number — contract — first line» as the subject", () => {
    const mail = buildInstructionMail(facts, t);
    expect(mail.to).toBe("m.andreou@contractor.example");
    expect(mail.subject).toBe("Οδηγία εργοταξίου 5 — ΤΥ/2026/031 — Κλείστε την πρόσβαση στον διάδρομο Β");
  });

  it("writes the instruction, the issue day as dd/mm/yyyy, the contract and project, and asks for the number in replies", () => {
    expect(buildInstructionMail(facts, t).body.split("\r\n")).toEqual([
      "Οδηγία εργοταξίου 5",
      "Σύμβαση: ΤΥ/2026/031, Κυριάκου Τεχνικές Κατασκευές Λτδ",
      "Έργο: LAR-2026-031 — Αντικατάσταση ακτινολογικού εξοπλισμού",
      "Ημερομηνία έκδοσης: 24/11/2026",
      "",
      "Οδηγία:",
      "Κλείστε την πρόσβαση στον διάδρομο Β",
      "μέχρι την Παρασκευή.",
      "",
      "Στην αλληλογραφία σας αναφέρετε τον αριθμό «Οδηγία εργοταξίου 5» και τη σύμβαση ΤΥ/2026/031.",
    ]);
  });

  it("shortens a long instruction with «…» and keeps the reply line", () => {
    const { body } = buildInstructionMail({ ...facts, textEl: "Α".repeat(5000) }, t);
    expect(body.length).toBeLessThanOrEqual(MAILTO_BODY_LIMIT);
    expect(body).toContain("Α…");
    expect(body.endsWith("και τη σύμβαση ΤΥ/2026/031.")).toBe(true);
  });

  it("names the draft SI-<number>.eml", () => {
    expect(instructionEmlFilename(5)).toBe("SI-5.eml");
  });
});
