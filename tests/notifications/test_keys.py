"""Every string key the Phase 4 pages, mails and routes use exists in both language files."""
import json
import re
from pathlib import Path

from tests.notifications.nhelpers import KNOWN_MISSING

ROOT = Path(__file__).resolve().parents[2]
I18N = ROOT / "ehr" / "i18n"
SOURCES = ([ROOT / "ehr/mail", ROOT / "ehr/scheduler", ROOT / "ehr/settings", ROOT / "ehr/templates/mail",
            ROOT / "ehr/templates/settings", ROOT / "ehr/services/notify.py", ROOT / "ehr/services/out_of_office.py",
            ROOT / "ehr/blueprints/me.py", ROOT / "ehr/templates/requests/list.html"])
PREFIXES = "mail|ooo|settings|validation|password|action|role|step|field|category|reason|docs|list|form|status"


def files():
    for item in SOURCES:
        yield from ([item] if item.is_file() else [p for p in item.rglob("*") if p.suffix in (".py", ".html", ".txt")])


def keys_used():
    used = set()
    for path in files():
        src = re.sub(r"""url_for\(\s*['"][^'"]+['"]""", "url_for(", path.read_text(encoding="utf-8"))
        used |= set(re.findall(r"""['"]((?:%s)\.[a-z_0-9]+(?:\.[a-z_0-9]+)*)['"]""" % PREFIXES, src))
        used |= set(re.findall(r"""\bt\(\s*['"]([a-z_]+(?:\.[a-z_0-9]+)+)['"]""", src))
    return {k for k in used if not k.endswith((".", "_")) and k not in ("settings.manage",)}


def test_phase_4_keys_exist_except_the_reported_ones():
    en = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    el = json.loads((I18N / "el.json").read_text(encoding="utf-8"))
    missing = {k for k in keys_used() if k not in en or k not in el}
    assert missing <= KNOWN_MISSING, sorted(missing - KNOWN_MISSING)


def test_known_missing_lists_only_keys_that_are_still_missing():
    en = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    el = json.loads((I18N / "el.json").read_text(encoding="utf-8"))
    written = {k for k in KNOWN_MISSING if k in en and k in el}
    assert not written, "now written, remove from KNOWN_MISSING: %s" % sorted(written)


def test_the_phase_4_contract_keys_all_exist():
    en = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    el = json.loads((I18N / "el.json").read_text(encoding="utf-8"))
    contract = (ROOT / "docs/contracts/04-string-keys.md").read_text(encoding="utf-8")
    tail = contract.split("## Phase 4 keys", 1)[1]
    keys = set(re.findall(r"^\| `([a-z_0-9.]+)` \|", tail, re.M))
    assert len(keys) > 60
    assert not [k for k in keys if k not in en or k not in el]
    assert set(en) == set(el)
