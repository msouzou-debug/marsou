"""Bake OKYπY's SAP master export into the tool.

Finance keeps the chart of accounts, the cost-centre master and the company
codes in one SAP export.  The tool used to need that file uploaded with every
month's ΟΑΥ reports; now the export travels INSIDE the tool and an upload only
replaces it when finance has a newer one.

    python tools/embed_sap_master.py path/to/Chart_of_accounts.XLSX

Writes recon/sap_embedded.py and webapp/js/sap_embedded.js — the same data for
both ports, read through the same reader an uploaded file goes through, so the
built-in master cannot drift from what an upload would have produced.  Re-run
it whenever finance issues a new export, then rebuild the single-file app with
`python webapp/build_single.py`.
"""
from __future__ import annotations

import datetime as _dt
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from recon.sapmaster import extract_sap_master        # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]

_PY = '''"""OKYπY's SAP master data, baked in — GENERATED FILE, DO NOT EDIT.

Produced by `python tools/embed_sap_master.py <export.xlsx>` from the export
finance maintains.  Re-run that script to refresh it; never hand-edit, or the
two ports drift apart.
"""

EMBEDDED_STAMP = {stamp!r}
EMBEDDED_SOURCE = {source!r}

COMPANIES = """\\
{companies}"""

CENTRES = """\\
{centres}"""

ACCOUNTS = """\\
{accounts}"""
'''

_JS = '''/* OKYπY's SAP master data, baked in — GENERATED FILE, DO NOT EDIT.
 *
 * Produced by `python tools/embed_sap_master.py <export.xlsx>` from the export
 * finance maintains.  Re-run that script to refresh it, then rebuild the
 * single-file app; never hand-edit, or the two ports drift apart. */

const SAP_EMBEDDED_STAMP = {stamp};
const SAP_EMBEDDED_SOURCE = {source};

const SAP_EMBEDDED_COMPANIES = {companies};

const SAP_EMBEDDED_CENTRES = {centres};

const SAP_EMBEDDED_ACCOUNTS = {accounts};
'''


def _lines(pairs) -> str:
    """One record per line, «field|field|field» — the smallest shape that
    survives being pasted into two languages unchanged."""
    return "\n".join("|".join(str(p).replace("|", "/").replace("\n", " ").strip()
                              for p in row) for row in pairs)


def _py_block(s: str) -> str:
    """The blob inside a triple-quoted literal, with the two characters that
    could close it early neutralised."""
    return s.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')


def _js_string(s: str) -> str:
    """A JS string literal, newlines escaped — no template literals, so the
    text cannot be broken by a backtick or a ${ in a Greek clinic name."""
    body = (s.replace("\\", "\\\\").replace("'", "\\'")
             .replace("\n", "\\n"))
    return f"'{body}'"


def main(argv: list) -> int:
    if not argv:
        print(__doc__)
        return 2
    src = pathlib.Path(argv[0])
    stamp = argv[1] if len(argv) > 1 else _dt.date.today().isoformat()
    master = extract_sap_master(src.read_bytes())
    if not master.cost_centres or not master.accounts:
        print(f"{src.name}: no cost centres or no chart of accounts — "
              "is this the SAP master export?")
        return 1

    companies = _lines(sorted(master.companies.items()))
    centres = _lines((c.company, c.code, c.name) for c in master.cost_centres)
    accounts = _lines(sorted(master.accounts.items()))

    (ROOT / "recon" / "sap_embedded.py").write_text(
        _PY.format(stamp=stamp, source=src.name,
                   companies=_py_block(companies), centres=_py_block(centres),
                   accounts=_py_block(accounts)), encoding="utf-8")
    (ROOT / "webapp" / "js" / "sap_embedded.js").write_text(
        _JS.format(stamp=_js_string(stamp), source=_js_string(src.name),
                   companies=_js_string(companies),
                   centres=_js_string(centres),
                   accounts=_js_string(accounts)), encoding="utf-8")
    print(f"embedded {src.name} ({stamp}): {len(master.companies)} companies, "
          f"{len(master.cost_centres)} cost centres, "
          f"{len(master.accounts)} accounts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
