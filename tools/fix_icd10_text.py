# -*- coding: utf-8 -*-
"""
Corrects character-level defects in seed/icd10.csv.

The Μονάδα's catalogue is their document and we do not rewrite a diagnosis. What this
corrects is the keyboard, not the medicine: characters that are wrong whatever the
description says, every one of which is invisible on screen and breaks the search.

    1. Letters typed on the wrong keyboard, in both directions —
       A59.8 «Tριχομονάδωση» opening with a Latin T, K22.7 «Οισοφάγος του Βarrett»
       with a Greek Β, E27.2 «Κρίση Αddison», Y58.0 «Εμβόλιο ΒCG». 34 rows.
       fold_greek() does not map between alphabets, so a clerk typing «Τριχ» in Greek
       never found A59.8 at all.

    2. Karyotypes written with Greek Χ and Υ — «47,ΧΧΧ», «46,ΧΥ». 13 rows, and Q96.1
       «Καρυότυπος 46,Χ iso (Xq)» settles that it is an error rather than a convention:
       the Χ after the comma is Greek and the X in the brackets is Latin, on one line.

    3. A leading backtick — I51.0 «`Ελλείμματα…». Only at the start: the apostrophes in
       «O'nyong-nyong», «καθ' έξιν» and «απ' αυτό» are correct and are left alone.

    4. A Greek word glued to a Latin one — A23.3 «Βρουκέλωση απόBrucella canis».

    5. Runs of two or more spaces — 268 rows in Greek and 6 in English. These are not
       cosmetic: search_text keeps the spacing, so «Εντερίτιδα από» typed with one
       space does not match «Εντερίτιδα  από» stored with two.

Each letter in 1 is decided per word, by the letters that have no look-alike in the
other alphabet — Greek π, Latin F. A word they do not settle is left alone and reported,
because guessing at a diagnosis is worse than leaving a typo in one.

NOT corrected, and deliberately: B33.4 «(Καρδιο-)πνευμονικό σύνδρομο». The English reads
"(cardio-)pulmonary", so the optional prefix is ICD style, not a stray bracket.

    python3 tools/fix_icd10_text.py            # report
    python3 tools/fix_icd10_text.py --apply    # rewrite the CSV

Corrects the file this repository seeds from, and is deterministic, so running it on the
server produces the same result — which is how the correction reaches a machine whose
copy of icd10.csv is not in git (runbook §1c). tools/sync_diagnoses.py then carries it
into a live catalogue.
"""
import csv
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "seed" / "icd10.csv"

# Drawn identically in the two alphabets, so a reader cannot tell them apart.
LOOKALIKE = {"A": "Α", "B": "Β", "E": "Ε", "Z": "Ζ", "H": "Η", "I": "Ι", "K": "Κ",
             "M": "Μ", "N": "Ν", "O": "Ο", "P": "Ρ", "T": "Τ", "X": "Χ", "Y": "Υ",
             "o": "ο", "v": "ν"}
TO_GREEK = dict(LOOKALIKE)
TO_LATIN = {g: l for l, g in LOOKALIKE.items()}

GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")
LATIN = re.compile(r"[A-Za-z]")
WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def exclusive(word):
    """(Greek-only letters, Latin-only letters) in this word — the ones that settle it."""
    greek = sum(1 for c in word if GREEK.match(c) and c not in TO_LATIN)
    latin = sum(1 for c in word if LATIN.match(c) and c not in TO_GREEK)
    return greek, latin


# A karyotype: «45,Χ», «47,ΧΧΥ», and the bare «ΧΥ» that follows one in Q96.3. The
# whole-word form is applied only to a row that already carries a karyotype, and was
# checked against the catalogue first: it matches nothing else.
KARYOTYPE_ROW = re.compile(r"\d\d,\s?[ΧΥ]")
AFTER_COMMA = re.compile(r"(?<=\d,)[ΧΥ]{1,3}")
WHOLE_WORD = re.compile(r"(?<![^\s])[ΧΥ]{2,3}(?![^\s])")
XY = str.maketrans({"Χ": "X", "Υ": "Y"})

GLUED = re.compile(r"([\u0370-\u03ff])([A-Z][a-z])")
SPACES = re.compile(r"[ \t]{2,}")


def correct(text):
    """Returns (corrected, [words left alone])."""
    # A backtick only where no apostrophe can belong — the very first character.
    text = text.lstrip("`´")
    out = list(text)
    undecided = []
    for match in WORD.finditer(text):
        word = match.group(0)
        if not (GREEK.search(word) and LATIN.search(word)):
            continue
        greek, latin = exclusive(word)
        if greek > latin:
            table = TO_GREEK
        elif latin > greek:
            table = TO_LATIN
        else:
            undecided.append(word)
            continue
        for i, ch in enumerate(word):
            if ch in table:
                out[match.start() + i] = table[ch]
    text = "".join(out)

    if KARYOTYPE_ROW.search(text):
        text = AFTER_COMMA.sub(lambda m: m.group(0).translate(XY), text)
        text = WHOLE_WORD.sub(lambda m: m.group(0).translate(XY), text)

    text = GLUED.sub(r"\1 \2", text)
    return SPACES.sub(" ", text).strip(), undecided


def tidy(text):
    """Whitespace only — what the English column needs."""
    return SPACES.sub(" ", text or "").strip()


def classify(old, new):
    """Which defect this row had. Reported by class, because 289 character diffs is not
    something anybody reads."""
    if old.lstrip("`´") != old:
        return "backtick στην αρχή"
    if GLUED.search(old):
        return "κολλημένη λέξη"
    stripped_old, stripped_new = SPACES.sub(" ", old).strip(), new
    if stripped_old == stripped_new and SPACES.search(old):
        return "διπλά διαστήματα"
    if KARYOTYPE_ROW.search(old):
        return "καρυότυπος με ελληνικά Χ/Υ"
    return "γράμμα σε λάθος πληκτρολόγιο"


def main(argv):
    apply_changes = "--apply" in argv
    if not PATH.exists():
        raise SystemExit("Δεν βρέθηκε: %s — δες docs/deployment-runbook.md §1c" % PATH)

    with PATH.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    by_class, undecided, total = {}, [], 0
    for row in rows:
        fixed, left = correct(row["description_el"])
        if left:
            undecided.append((row["code"], row["description_el"], left))
        if fixed != row["description_el"]:
            kind = classify(row["description_el"], fixed)
            by_class.setdefault(kind, []).append(
                (row["code"], row["description_el"], fixed))
            row["description_el"] = fixed
            total += 1
        english = tidy(row["description_en"])
        if english != (row["description_en"] or ""):
            by_class.setdefault("διπλά διαστήματα (αγγλικά)", []).append(
                (row["code"], row["description_en"], english))
            row["description_en"] = english
            total += 1

    print("%d γραμμές, %d διορθώσεις" % (len(rows), total))
    for kind in sorted(by_class, key=lambda k: -len(by_class[k])):
        hits = by_class[kind]
        print("\n%-30s %4d" % (kind, len(hits)))
        for code, old, new in hits[:3]:
            print("   %-8s πριν  %s" % (code, old[:62]))
            print("   %-8s μετά  %s" % ("", new[:62]))
        if len(hits) > 3:
            print("   %-8s … και %d άλλες" % ("", len(hits) - 3))

    if undecided:
        print("\n%d λέξεις που δεν κρίθηκαν και έμειναν ως είναι:" % len(undecided))
        for code, text, words in undecided:
            print("  %-8s %-14s %s" % (code, "/".join(words), text[:50]))

    if not total:
        return 0
    if not apply_changes:
        print("\nΤίποτα δεν γράφτηκε. Για να εφαρμοστούν: --apply")
        return 1

    with PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["code", "description_el",
                                                    "description_en"])
        writer.writeheader()
        writer.writerows(rows)
    print("\nΓράφτηκε το %s" % PATH.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
