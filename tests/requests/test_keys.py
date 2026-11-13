"""Every string key used by the request screens is in the JSON files, except the ones reported as missing."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "ehr"
# Keys the Phase 2 screens need that the strings agent has not written yet (key: English text).
KNOWN_MISSING = set()
FILES = ([ROOT / "templates/requests", ROOT / "templates/components", ROOT / "blueprints/requests.py",
          ROOT / "services"])


def _sources():
    for item in FILES:
        yield from ([item] if item.is_file() else item.rglob("*.py" if item.name == "services" else "*.html"))


def test_literal_keys_exist():
    en = json.loads((ROOT / "i18n/en.json").read_text(encoding="utf-8"))
    el = json.loads((ROOT / "i18n/el.json").read_text(encoding="utf-8"))
    used = set()
    for path in _sources():
        used |= set(re.findall(r"""\bt\(\s*['"]([a-z_]+(?:\.[a-z_0-9]+)+)['"]""", path.read_text(encoding="utf-8")))
        used |= set(re.findall(r"""['"]((?:form|field|list|validation|tracker|page|docs|action|answer|statusline|card|done|error|closed|history|opinion|documentation)\.[a-z_0-9.]+)['"]""",
                               path.read_text(encoding="utf-8")))
    missing = {k for k in used if not k.endswith('.') and (k not in en or k not in el)}
    assert missing <= KNOWN_MISSING, sorted(missing - KNOWN_MISSING)
