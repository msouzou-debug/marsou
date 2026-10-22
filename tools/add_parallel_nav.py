# -*- coding: utf-8 -*-
"""
Adds the «Παράλληλη λειτουργία» link to eFinance's ΤΑΕΠ sidebar block.

Run on the eFinance server after copying the new taep.py and templates:

    sudo python3 /home/administrator/marsou/tools/add_parallel_nav.py

Anchored on the readiness link that is already in the block, not on a line number, so a
base.html that has moved on since this was written is still handled — and if the anchor
is not there exactly once it stops rather than guessing. The result is parsed as Jinja
before it is written, because a broken base.html takes down every page in eFinance, not
just ours. Safe to run twice.
"""
import datetime
import io
import shutil
import sys

PATH = "/opt/finance/templates/base.html"
NEW = ("    <a href=\"/taep/parallel\" class=\"nav-link nav-sub "
       "{% if request.path.startswith('/taep/parallel') %}active{% endif %}\">"
       "{{ t('Παράλληλη λειτουργία') }}</a>\n")


def main(path=PATH):
    from jinja2 import Environment

    text = io.open(path, encoding="utf-8").read()
    if "/taep/parallel" in text:
        print("Υπάρχει ήδη. Καμία αλλαγή.")
        return 0

    anchor = [line for line in text.splitlines(True)
              if 'href="/taep/readiness"' in line]
    if len(anchor) != 1:
        raise SystemExit(
            "Βρέθηκαν %d γραμμές «/taep/readiness», περίμενα 1. Σταματώ χωρίς αλλαγή."
            % len(anchor))

    updated = text.replace(anchor[0], NEW + anchor[0], 1)
    Environment().parse(updated)          # σπάει εδώ, όχι στον χρήστη
    backup = path + ".bak-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, backup)
    io.open(path, "w", encoding="utf-8").write(updated)
    print("Προστέθηκε ο σύνδεσμος. Αντίγραφο: %s" % backup)
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
