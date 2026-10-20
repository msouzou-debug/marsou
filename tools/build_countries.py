# -*- coding: utf-8 -*-
"""
Builds seed/countries.csv from Unicode CLDR territory names.

CLDR is the source the rest of the world localises country names from, so the Greek
spellings match what people see everywhere else rather than a translation of our own.

Download both files first, then pass their paths:

    curl -sS -o el.json https://raw.githubusercontent.com/unicode-org/cldr-json/main/\
cldr-json/cldr-localenames-full/main/el/territories.json
    curl -sS -o en.json .../en/territories.json
    python3 -I tools/build_countries.py el.json en.json

Run with -I: the JSON arrives from the internet and sits in its own directory, so the
interpreter must not add that directory to the import path.
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Not countries: CLDR carries continents and groupings under numeric codes, and a handful
# of two-letter codes that are unions, outlying areas or placeholders.
NOT_A_COUNTRY = {
    "EU",   # Ευρωπαϊκή Ένωση
    "EZ",   # Ευρωζώνη
    "UN",   # Ηνωμένα Έθνη
    "QO",   # Απομακρυσμένη Ωκεανία
    "ZZ",   # Άγνωστη περιοχή
    "XA", "XB",   # pseudo-locales used for testing
}

# The identification document in front of the clerk is Cypriot far more often than
# anything else, so it leads. Everything after is alphabetical in Greek.
FIRST = "CY"


def territories(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    main = data["main"]
    locale = next(iter(main))
    return main[locale]["localeDisplayNames"]["territories"]


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 1
    el, en = territories(argv[0]), territories(argv[1])

    rows = []
    for code, name_el in el.items():
        if "-alt-" in code:              # "CD-alt-variant" and friends
            continue
        if not (len(code) == 2 and code.isalpha()):
            continue                     # numeric codes are continents and regions
        if code in NOT_A_COUNTRY:
            continue
        rows.append({"code": code, "name_el": name_el,
                     "name_en": en.get(code, name_el)})

    rows.sort(key=lambda r: (r["code"] != FIRST, r["name_el"]))
    for order, row in enumerate(rows, 1):
        row["sort_order"] = order

    path = ROOT / "seed" / "countries.csv"
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["code", "name_el", "name_en",
                                                    "sort_order"])
        writer.writeheader()
        writer.writerows(rows)

    print("wrote %s — %d countries, %s first" % (path, len(rows), rows[0]["name_el"]))
    for row in rows[:4]:
        print("   %s  %-28s %s" % (row["code"], row["name_el"], row["name_en"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
