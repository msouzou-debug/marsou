"""Every string key the deposit code and templates use exists in both language files."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [ROOT / "ehr/archive", ROOT / "ehr/templates/archive", ROOT / "ehr/templates/settings/archive.html",
           ROOT / "ehr/settings/archive.py", ROOT / "ehr/templates/requests/detail.html"]
PREFIX = (r"archive|pdf|settings|page|card|field|step|role|status|history|tracker|docs|employment|category|reason|"
          r"answer|opinion|documentation")


def used():
    found = set()
    for item in SOURCES:
        for path in ([item] if item.is_file() else [p for p in item.rglob("*") if p.suffix in (".py", ".html")]):
            src = path.read_text(encoding="utf-8")
            found |= set(re.findall(r"""\bt\(\s*['"]((?:%s)\.[a-z_0-9.]+)['"]""" % PREFIX, src))
            if path.suffix == ".py":
                found |= set(re.findall(r"""['"]((?:%s)\.[a-z_0-9]+(?:\.[a-z_0-9]+)*)['"]""" % PREFIX, src))
    return {k for k in found if not k.endswith(".") and k not in ("settings.manage",)}


def test_every_key_used_exists_in_both_languages():
    en = json.loads((ROOT / "ehr/i18n/en.json").read_text(encoding="utf-8"))
    el = json.loads((ROOT / "ehr/i18n/el.json").read_text(encoding="utf-8"))
    keys = used()
    assert "pdf.title" in keys and "settings.archive.view_pdf" in keys
    assert not sorted(k for k in keys if k not in en or k not in el)


def test_the_contract_keys_have_both_texts():
    en = json.loads((ROOT / "ehr/i18n/en.json").read_text(encoding="utf-8"))
    el = json.loads((ROOT / "ehr/i18n/el.json").read_text(encoding="utf-8"))
    for key in ("archive.title", "archive.state.queued", "archive.state.stored", "archive.state.failed", "archive.ref",
                "archive.kind.submitted", "archive.kind.approved", "settings.archive", "settings.archive.off",
                "settings.archive.retry", "settings.archive.retried", "settings.archive.empty",
                "settings.archive.view_pdf", "pdf.title", "pdf.generated", "pdf.leavers", "pdf.financials",
                "pdf.documents_list", "pdf.status_at"):
        assert en[key] and el[key], key
