# -*- coding: utf-8 -*-
"""
Corrects Greek/Latin letter confusion in seed/icd10.csv.

The Μονάδα's catalogue has 34 descriptions where a letter was typed on the wrong
keyboard. Both directions occur:

    A59.8  Tριχομονάδωση   — a Greek word opening with a Latin T
    K22.7  Οισοφάγος του Βarrett  — a Latin name with a Greek Β
    E27.2  Κρίση Αddison   — the same, in the middle of a line
    Y58.0  Εμβόλιο ΒCG     — a Latin abbreviation with a Greek Β

They are invisible on screen, because the two letters are drawn identically, and they
break the search outright: fold_greek() does not map between alphabets, so a clerk
typing «Τριχ» with a Greek Τ never finds «Tριχομονάδωση».

Each decision is made per word, not per character. A word that mixes the alphabets is
assigned to whichever one its EXCLUSIVE letters belong to — letters with no look-alike
in the other alphabet, such as Greek π or Latin F — and only then are its look-alikes
converted. A word whose exclusive letters do not settle it is left alone and reported,
because guessing at a diagnosis is worse than leaving a typo in one.

    python3 tools/fix_icd10_letters.py            # report
    python3 tools/fix_icd10_letters.py --apply    # rewrite the CSV

Corrects the file this repository seeds from. tools/sync_diagnoses.py carries the
correction to a server that already holds the catalogue.
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


def correct(text):
    """Returns (corrected, [words left alone])."""
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
    return "".join(out), undecided


def main(argv):
    apply_changes = "--apply" in argv
    if not PATH.exists():
        raise SystemExit("Δεν βρέθηκε: %s — δες docs/deployment-runbook.md §1c" % PATH)

    with PATH.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    changed, undecided = [], []
    for row in rows:
        fixed, left = correct(row["description_el"])
        if left:
            undecided.append((row["code"], row["description_el"], left))
        if fixed != row["description_el"]:
            changed.append((row["code"], row["description_el"], fixed))
            row["description_el"] = fixed

    print("%d γραμμές, %d διορθώσεις" % (len(rows), len(changed)))
    for code, old, new in changed:
        marks = ", ".join("%s→%s" % (old[i], new[i])
                          for i in range(len(old)) if old[i] != new[i])
        print("  %-8s %-24s %s" % (code, marks, new[:56]))

    if undecided:
        print("\n%d λέξεις που δεν κρίθηκαν και έμειναν ως είναι:" % len(undecided))
        for code, text, words in undecided:
            print("  %-8s %-14s %s" % (code, "/".join(words), text[:50]))

    if not changed:
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
