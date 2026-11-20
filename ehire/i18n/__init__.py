"""String resources. Every user-facing string lives in el.json / en.json, never in code or templates."""
import json
from pathlib import Path

_DIR = Path(__file__).parent
_CACHE = {}


def load(lang):
    if lang not in _CACHE:
        with open(_DIR / f"{lang}.json", encoding="utf-8") as fh:
            _CACHE[lang] = json.load(fh)
    return _CACHE[lang]


def translate(key, lang, **params):
    """Return the string for key. A missing key returns the key itself so gaps are visible."""
    text = load(lang).get(key, key)
    return text.format(**params) if params else text


def plural_key(key, n):
    """The key for a count: `<key>.one` for exactly 1, `<key>.many` otherwise. Both forms are written out in the
    string files, so each language words its own singular and plural (and 0 takes the plural, as in both languages)."""
    return "%s.%s" % (key, "one" if n == 1 else "many")
