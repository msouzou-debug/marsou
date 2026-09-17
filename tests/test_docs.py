"""The two generated files — the manual the app shows and the SAP master it
carries — must be what their sources say they are.

Both are produced by a script and committed, so the only way they can go wrong
is by somebody editing the source and forgetting to re-run it.  These tests are
that reminder.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANUAL = ROOT / "docs" / "MANUAL.md"
MANUAL_JS = ROOT / "webapp" / "js" / "manual.js"
SINGLE = ROOT / "webapp" / "okypy-recon.html"


def test_the_manual_in_the_app_is_the_manual_in_the_repository():
    sys.path.insert(0, str(ROOT / "tools"))
    import embed_manual                                # noqa: PLC0415

    before = MANUAL_JS.read_text(encoding="utf-8")
    embed_manual.main()
    assert MANUAL_JS.read_text(encoding="utf-8") == before, (
        "docs/MANUAL.md changed without re-running tools/embed_manual.py")


def test_the_manual_covers_what_the_month_actually_needs():
    text = MANUAL.read_text(encoding="utf-8")
    for want in ("SRA", "Αμοιβή Φαρμακοποιού", "cross-check mode",
                 "ZSHSO_FI_POST_UPL_V1", "Chart_of_accounts.XLSX",
                 "tools/embed_sap_master.py", "JOURNAL ENTRIES"):
        assert want in text, want


def test_both_ports_carry_the_same_embedded_master():
    from recon import sap_embedded as py                # noqa: PLC0415

    js = (ROOT / "webapp" / "js" / "sap_embedded.js").read_text(encoding="utf-8")

    def literal(name: str) -> str:
        m = re.search(rf"const {name} = '(.*)';", js)
        assert m, name
        return (m.group(1).replace("\\n", "\n").replace("\\'", "'")
                .replace("\\\\", "\\"))

    assert literal("SAP_EMBEDDED_STAMP") == py.EMBEDDED_STAMP
    assert literal("SAP_EMBEDDED_SOURCE") == py.EMBEDDED_SOURCE
    assert literal("SAP_EMBEDDED_COMPANIES") == py.COMPANIES
    assert literal("SAP_EMBEDDED_CENTRES") == py.CENTRES
    assert literal("SAP_EMBEDDED_ACCOUNTS") == py.ACCOUNTS


def test_the_single_file_app_was_rebuilt_after_the_last_change():
    """okypy-recon.html is what the user actually opens — a stale build means
    the fix never reached them."""
    built = SINGLE.read_text(encoding="utf-8")
    for js in sorted((ROOT / "webapp" / "js").glob("*.js")):
        body = js.read_text(encoding="utf-8").replace("</script", "<\\/script")
        assert body in built, f"{js.name} is newer than okypy-recon.html — " \
                              "run python webapp/build_single.py"


def test_the_build_script_is_not_left_out_of_the_repository_docs():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "docs/MANUAL.md" in readme
