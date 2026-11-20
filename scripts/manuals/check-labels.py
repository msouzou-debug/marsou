"""Checks that every on-screen label quoted in the manuals' text files exists in the app's strings.

Greek files (user-el.js, admin-el.js): every «…» must match a value in ehire/i18n/el.json.
English files (user-en.js, admin-en.js): every **…** must match a value in ehire/i18n/en.json.
A value with a placeholder ({n}, {who}, …) matches any text in its place. A trailing full stop is ignored.

Usage: python3 scripts/manuals/check-labels.py
Prints, per file, the quoted texts with no match. "(part of a label)" means the text is inside a longer label,
which is usually fine (a label quoted in part). Everything else needs a look: a changed label, or a quote
that is not a label at all (EL, EN, Ελληνικά and English are written in the templates, not in the JSON).
Exit code 0 always: this is a reading aid, not a test. Needs node to read the data files."""
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HARD_CODED = {"EL", "EN", "Ελληνικά", "English", "(δείγμα)"}  # in templates or sample data, not in the JSON


def pattern(value):
    """A regex for a string value, with each {placeholder} matching any text (a number, a name)."""
    parts = re.split(r"\{[a-z_]+\}", value)
    return re.compile("^" + ".+".join(re.escape(p) for p in parts) + "$")


def main():
    for lang, quote in (("el", r"«([^»]+)»"), ("en", r"\*\*([^*]+)\*\*")):
        with open(os.path.join(ROOT, "ehire", "i18n", lang + ".json"), encoding="utf-8") as fh:
            values = list(json.load(fh).values())
        exact = set(values)
        loose = [pattern(v) for v in values if "{" in v]
        blob = "\n".join(values)
        for name in ("user", "admin"):
            path = os.path.join(ROOT, "scripts", "manuals", "%s-%s.js" % (name, lang))
            data = subprocess.check_output(["node", "-e", "process.stdout.write(JSON.stringify(require(%s)))" % json.dumps(path)])
            text = json.dumps(json.loads(data), ensure_ascii=False)
            problems = set()
            for found in re.findall(quote, text):
                label = found.replace('\\"', '"').strip()
                if label in HARD_CODED or label.rstrip(".") in HARD_CODED:
                    continue
                if label in exact or label + "." in exact or label.rstrip(".") in exact:
                    continue
                if any(p.match(label) or p.match(label + ".") for p in loose):
                    continue
                problems.add(("(part of a label) " if label in blob else "") + label)
            print("%s-%s: %s" % (name, lang, "ok" if not problems else ""))
            for p in sorted(problems):
                print("   ", p)


if __name__ == "__main__":
    main()
