// S07c — owner request 26/11/2026: «site instructions need same facility to
// send e-mails as RFI».
//
// The RFI's message (`s07b-rfis/rfi-mail.ts`), for an instruction: the
// recipient, a subject (number — contract — the instruction's first line) and
// a body with the instruction, the contract and project, the day it was
// issued, and a request to quote the number in any reply. The same text goes
// into the `mailto:` link of «Αποστολή με e-mail» and into the .eml draft of
// «Αποθήκευση και αποστολή e-mail»; eCapital itself sends nothing.
//
// RULE: as for the RFI, the body is kept to `MAILTO_BODY_LIMIT` characters —
// the instruction is shortened with «…» so the reply line always arrives.
import { formatDate } from "@/lib/format";
import { firstLine, shorten, type MailDraft } from "@/lib/mail-draft";
import { MAILTO_BODY_LIMIT, SUBJECT_QUESTION_LIMIT } from "@/screens/s07b-rfis/rfi-mail";

const CRLF = "\r\n";

export interface InstructionMailFacts {
  number: number;
  textEl: string;
  recipientEmail: string;
  /** ISO instant; said as dd/mm/yyyy in Nicosia. */
  issuedAt: string;
  contractNo: string;
  contractorName?: string | null;
  projectCode?: string | null;
  projectTitle?: string | null;
}

/** `screens.s07c.email.*`, already bound to the caller's locale. */
export type InstructionMailTranslate = (
  key: "subject" | "instructionLine" | "contractLine" | "projectLine" | "issuedLine" | "textLine" | "quoteLine",
  values?: Record<string, string | number>,
) => string;

/** The draft's file name, `SI-<number>.eml` (site instruction), ASCII like `RFI-<number>.eml`. */
export function instructionEmlFilename(number: number): string {
  return `SI-${number}.eml`;
}

export function buildInstructionMail(facts: InstructionMailFacts, t: InstructionMailTranslate): MailDraft {
  const contract = facts.contractorName ? `${facts.contractNo}, ${facts.contractorName}` : facts.contractNo;
  const project = [facts.projectCode, facts.projectTitle].filter(Boolean).join(" — ");

  const subject = t("subject", {
    number: facts.number,
    contract: facts.contractNo,
    text: firstLine(facts.textEl, SUBJECT_QUESTION_LIMIT),
  });

  const compose = (text: string) =>
    [
      t("instructionLine", { number: facts.number }),
      t("contractLine", { contract }),
      ...(project ? [t("projectLine", { project })] : []),
      t("issuedLine", { date: formatDate(facts.issuedAt) }),
      "",
      t("textLine"),
      text,
      "",
      t("quoteLine", { number: facts.number, contract: facts.contractNo }),
    ].join(CRLF);

  const text = facts.textEl.trim().replace(/\r?\n/g, CRLF);
  let body = compose(text);
  if (body.length > MAILTO_BODY_LIMIT) {
    const room = text.length - (body.length - MAILTO_BODY_LIMIT);
    body = compose(shorten(text, room));
  }
  return { to: facts.recipientEmail.trim(), subject, body };
}
