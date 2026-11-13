"""Request numbers: format and search normalisation (contract 01, Number search).

Code points are written as numbers so the source holds no Greek literals.
"""
import unicodedata

# Alpha Beta Epsilon Zeta Eta Iota Kappa Mu Nu Omicron Rho Tau Upsilon Chi
_GREEK_TO_LATIN = dict(zip(
    (chr(c) for c in (0x391, 0x392, 0x395, 0x396, 0x397, 0x399, 0x39A, 0x39C,
                      0x39D, 0x39F, 0x3A1, 0x3A4, 0x3A5, 0x3A7)),
    "ABEZHIKMNOPTYX"))
# hyphen-minus, hyphen, non-breaking hyphen, figure dash, en dash, em dash, minus sign
_DASHES = {chr(c) for c in (0x2D, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212)}


def format_number(prefix, year, value):
    return "{}-{}-{:04d}".format(prefix, year, int(value))


def normalise_number(text):
    decomposed = unicodedata.normalize("NFD", text or "")
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    out = []
    for ch in stripped.upper():
        if ch.isspace() or ch in _DASHES:
            continue
        out.append(_GREEK_TO_LATIN.get(ch, ch))
    return "".join(out)
