/**
 * The same folding `ecapital.normalise` does in SQL, in TypeScript.
 *
 * R14 remembers an allocation by vendor plus narrative, and the two sides of
 * that comparison are written in different places: the rule's key is folded
 * by Postgres when it is stored, and the incoming SAP row is folded here
 * before it is looked up. If the two ever stopped agreeing, a remembered
 * rule would silently stop matching and the unmatched queue would quietly
 * grow again — so they are the same table of characters, and a test asserts
 * that the two implementations answer the same for the awkward strings.
 *
 * `src/cli/text.ts` folds titles for the capex importer's natural key; this
 * one folds vendor names and narratives. Same idea, different key.
 */

// Exactly the pair of strings in ecapital.normalise (migration 0002).
const FROM = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰς";
const TO = "αβγδεζηθικλμνξοπρστυφχψωαεηιουωιυαεηιουωιυιυσ";

const TABLE = new Map<string, string>();
for (let index = 0; index < FROM.length; index += 1) {
  TABLE.set(FROM[index], TO[index] ?? "");
}

/** lower(translate(text, …)) — the SQL function, character for character. */
export function normalise(text: string): string {
  let out = "";
  for (const char of text) out += TABLE.get(char) ?? char;
  return out.toLowerCase();
}

/**
 * What a remembered rule is keyed on: the narrative with its digits, dates
 * and punctuation taken out, so «ΤΙΜΟΛΟΓΙΟ 4417/ΜΑΡΤΙΟΣ» and «Τιμολόγιο
 * 4692 / Απρίλιος» are the same rule and next month's invoice matches the
 * one somebody allocated by hand this month.
 */
export function ruleText(description: string | null): string {
  if (!description) return "";
  return normalise(description)
    .replace(/[0-9]+/g, " ")
    .replace(/[^\p{L}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
