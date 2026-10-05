# -*- coding: utf-8 -*-
"""
Go-live readiness check, from the command line.

Run it on the eFinance server after installing, once per hospital, before letting a
clerk near it. Exits non-zero if anything blocks, so it works in a deploy script.

    python3 tools/check_readiness.py              # against a temporary demo database
    FINANCE_DB=/opt/finance/finance.db python3 tools/check_readiness.py
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import taep            # noqa: E402
import taep_harness    # noqa: E402


def main():
    database = os.environ.get("FINANCE_DB")
    if database:
        ctx = {"db_execute": taep_harness.make_db(database),
               "log_activity": lambda *args, **kwargs: None}
        print(f"Έλεγχος: {database}")
    else:
        directory = tempfile.mkdtemp()
        ctx = taep_harness.make_ctx(directory)
        print(f"Έλεγχος: προσωρινή βάση με πλήρη δεδομένα ({directory})")

    findings = taep.readiness_report(ctx)
    print()
    for finding in findings:
        marker = "ΕΜΠΟΔΙΟ " if finding["level"] == "blocker" else "ΠΡΟΣΟΧΗ "
        print(f"  {marker} [{finding['check']}] {finding['detail']}")
    if not findings:
        print("  Όλοι οι έλεγχοι πέρασαν.")

    print(f"\n{taep.readiness_summary(findings)}")
    return 1 if any(f["level"] == "blocker" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
