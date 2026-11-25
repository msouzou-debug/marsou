// S07b — owner UAT 25/11/2026: «The RFI should go through e-mail; it does not
// right now.»
//
// eCapital has no outgoing mail server (there is no SMTP relay on the ΟΚΥπΥ
// network yet), so the RFI leaves from the engineer's own Outlook: «Αποστολή
// με e-mail» is a `mailto:` link with the recipient, the subject and the body
// already filled in. Nothing is sent from here and nothing is logged as sent;
// the engineer records the day it left and files the sent message under
// «Αλληλογραφία», exactly as before.
//
// RULE: a `mailto:` link has no agreed length limit, and some mail programs
// cut a long one off or refuse to open it. The body is kept to
// `MAILTO_BODY_LIMIT` characters: the question is shortened, with «…», so
// that the lines after it — above all «quote the RFI number in your reply» —
// always arrive.
import { formatDate } from "@/lib/format";

export const MAILTO_BODY_LIMIT = 1800;
/** The question's share of the subject line. */
export const SUBJECT_QUESTION_LIMIT = 60;

const ELLIPSIS = "…";
const CRLF = "\r\n";

export interface RfiMailFacts {
  number: number;
  questionEl: string;
  recipientEmail: string;
  /** ISO instant; said as dd/mm/yyyy in Nicosia. */
  slaDueAt: string;
  contractNo: string;
  contractorName?: string | null;
  projectCode?: string | null;
  projectTitle?: string | null;
}

/** `screens.s07b.email.*`, already bound to the caller's locale. */
export type RfiMailTranslate = (
  key: "subject" | "rfiLine" | "contractLine" | "projectLine" | "dueLine" | "questionLine" | "quoteLine",
  values?: Record<string, string | number>,
) => string;

export interface RfiMail {
  to: string;
  subject: string;
  body: string;
}

function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}${ELLIPSIS}`;
}

/** The first line of the question, on one line, for the subject. */
export function shortQuestion(question: string, limit = SUBJECT_QUESTION_LIMIT): string {
  const firstLine = question.trim().split(/\r?\n/)[0] ?? "";
  return shorten(firstLine.replace(/\s+/g, " "), limit);
}

export function buildRfiMail(facts: RfiMailFacts, t: RfiMailTranslate): RfiMail {
  const contract = facts.contractorName ? `${facts.contractNo}, ${facts.contractorName}` : facts.contractNo;
  const project = [facts.projectCode, facts.projectTitle].filter(Boolean).join(" — ");

  const subject = t("subject", {
    number: facts.number,
    contract: facts.contractNo,
    question: shortQuestion(facts.questionEl),
  });

  const compose = (question: string) =>
    [
      t("rfiLine", { number: facts.number }),
      t("contractLine", { contract }),
      ...(project ? [t("projectLine", { project })] : []),
      t("dueLine", { date: formatDate(facts.slaDueAt) }),
      "",
      t("questionLine"),
      question,
      "",
      t("quoteLine", { number: facts.number, contract: facts.contractNo }),
    ].join(CRLF);

  const question = facts.questionEl.trim().replace(/\r?\n/g, CRLF);
  let body = compose(question);
  if (body.length > MAILTO_BODY_LIMIT) {
    const room = question.length - (body.length - MAILTO_BODY_LIMIT);
    body = compose(shorten(question, room));
  }
  return { to: facts.recipientEmail.trim(), subject, body };
}

/**
 * RFC 6068. Everything is percent-encoded but the `@` of the address, which
 * some mail programs do not decode in the address part.
 */
export function mailtoHref(mail: RfiMail): string {
  const to = encodeURIComponent(mail.to).replace(/%40/g, "@");
  return `mailto:${to}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
}
