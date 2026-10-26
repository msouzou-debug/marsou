# -*- coding: utf-8 -*-
"""
Turns the Μονάδα's ICD-10 workbook into seed/icd10.csv.

    python3 tools/build_icd10.py <ICD10_version_2016_1.xlsx>

The workbook supplied on 26/10/2026 holds 10.560 codes with an English and a Greek
description each. Columns kept: the code, the English, the Greek. The fourth column is a
WHO browser URL and is dropped — it points outside the ΟΚΥπΥ network, so it could not be
followed from the server even if anyone wanted to.

Reports rather than repairs. The catalogue is the Μονάδα's, and a code that looks odd is
theirs to rule on, not ours to drop.
"""
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "seed" / "icd10.csv"
STANDARD = re.compile(r"[A-Z]\d{2}(\.\d{1,2})?$")


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 1
    from openpyxl import load_workbook

    sheet = load_workbook(argv[0], read_only=True, data_only=True).active
    header = [str(c or "").strip()
              for c in next(sheet.iter_rows(max_row=1, values_only=True))]
    expected = ["Diagnosis Type Id", "Diagnosis Id", "Diagnosis Description",
                "Diagnosis Description Long"]
    if header[:4] != expected:
        raise SystemExit("Οι στήλες δεν είναι αυτές που περιμένουμε:\n  %s" % header)

    rows, seen, problems = [], set(), []
    for number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        kind, code, english, greek = (str(c or "").strip() for c in row[:4])
        if not code:
            continue
        if kind != "ICD10":
            problems.append("γραμμή %d: τύπος «%s»" % (number, kind))
        if code in seen:
            problems.append("γραμμή %d: διπλός κωδικός %s" % (number, code))
            continue
        seen.add(code)
        if not greek or not english:
            problems.append("γραμμή %d: %s χωρίς περιγραφή" % (number, code))
        # 255 exactly means the source truncated it, not that the text ends there.
        if len(greek) == 255:
            problems.append("γραμμή %d: %s — η ελληνική περιγραφή κόπηκε στους 255 "
                            "χαρακτήρες στην πηγή" % (number, code))
        if not STANDARD.match(code):
            problems.append("γραμμή %d: %s δεν έχει τη συνήθη μορφή ICD-10 "
                            "(κρατήθηκε)" % (number, code))
        rows.append((code, greek, english))

    rows.sort(key=lambda r: r[0])
    with open(TARGET, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["code", "description_el", "description_en"])
        writer.writerows(rows)

    print("έγραψε %s — %d διαγνώσεις" % (TARGET, len(rows)))
    if problems:
        print("\n%d σημεία για τη Μονάδα:" % len(problems))
        for problem in problems:
            print("   " + problem)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
