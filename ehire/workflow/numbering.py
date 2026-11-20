"""Request numbers: format and search normalisation (contract 01, Number search).

Code points are written as numbers so the source holds no Greek literals.
"""
import unicodedata

# Alpha Beta Epsilon Zeta Eta Theta Iota Kappa Mu Nu Omicron Rho Tau Upsilon Chi.
# Theta is typed as U on a Latin keyboard (the number prefix is AEU), so it maps to U.
# ehire/models/request.py keeps a copy of this map; a test keeps the two equal.
_GREEK_TO_LATIN = dict(zip(
    (chr(c) for c in (0x391, 0x392, 0x395, 0x396, 0x397, 0x398, 0x399, 0x39A, 0x39C,
                      0x39D, 0x39F, 0x3A1, 0x3A4, 0x3A5, 0x3A7)),
    "ABEZHUIKMNOPTYX"))
# hyphen-minus, hyphen, non-breaking hyphen, figure dash, en dash, em dash, minus sign
_LATIN_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_DASHES = {chr(c) for c in (0x2D, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212)}


def format_number(prefix, year, value):
    """The old yearly shape, PREFIX-YYYY-NNNN. No longer issued; kept so old numbers can be built in tests."""
    return "{}-{}-{:04d}".format(prefix, year, int(value))


# Fallback position code per staff category, used when a position has no code of its own.
CATEGORY_CODES = {"medical": "MED", "nursing": "NUR", "allied": "ALH", "admin": "ADM", "other": "OTH"}
FALLBACK_CATEGORY_CODE = "OTH"


def clean_code(text):
    """Upper-case Latin letters and digits only; everything else is dropped. May return an empty string."""
    return "".join(c for c in (text or "").upper() if c in _LATIN_UPPER or c in "0123456789")


def directorate_part(code):
    """The Directorate code as used in a number: cleaned, or X if nothing is left."""
    return clean_code(code) or "X"


def valid_position_code(text):
    """True for 2 to 6 Latin capital letters or digits (the stored form of a position code)."""
    text = text or ""
    return 2 <= len(text) <= 6 and all(c in _LATIN_UPPER or c in "0123456789" for c in text)


def position_part(code, category):
    """The position code as used in a number: the position's own code, else the category's fixed one."""
    code = (code or "").strip().upper()
    if valid_position_code(code):
        return code
    return CATEGORY_CODES.get(category, FALLBACK_CATEGORY_CODE)


def number_stem(prefix, directorate_code, position_code, category, day):
    """PREFIX-DIR-POS-YYYYMMDD, the key a counter runs under. `day` is the submission date in local time."""
    return "{}-{}-{}-{:04d}{:02d}{:02d}".format(
        prefix, directorate_part(directorate_code), position_part(position_code, category),
        day.year, day.month, day.day)


def format_request_number(stem, value):
    """STEM-NN; two digits, three or more once the counter passes 99."""
    return "{}-{:02d}".format(stem, int(value))


def normalise_number(text):
    decomposed = unicodedata.normalize("NFD", text or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    out = []
    for ch in stripped.upper():
        if ch.isspace() or ch in _DASHES:
            continue
        out.append(_GREEK_TO_LATIN.get(ch, ch))
    return "".join(out)
