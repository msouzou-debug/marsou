"""Name / identifier normalization for duplicate matching.

The dominant duplicate pattern in this vendor master is Greek<->Latin
transliteration doubles (ΕΛΛΗΝΑΣ vs ELLINAS), plus spelling variants and
name-order swaps, so names are uppercased, stripped of legal suffixes,
transliterated Greek->Latin and token-sorted before comparison.
"""

import re
import unicodedata

# Matching-oriented Greek->Latin map (digraphs first). Deliberately folds
# eta/upsilon toward I/Y the way OKYpY vendor names are romanized; residual
# one-letter differences are absorbed by the fuzzy score.
_DIGRAPHS = [
    ("ΟΥ", "OU"), ("ΑΥ", "AV"), ("ΕΥ", "EV"),
    ("ΜΠ", "B"), ("ΝΤ", "D"), ("ΓΚ", "G"), ("ΓΓ", "NG"),
    ("ΤΣ", "TS"), ("ΤΖ", "TZ"), ("ΘΕ", "THE"),
]
_LETTERS = {
    "Α": "A", "Β": "V", "Γ": "G", "Δ": "D", "Ε": "E", "Ζ": "Z", "Η": "I",
    "Θ": "TH", "Ι": "I", "Κ": "K", "Λ": "L", "Μ": "M", "Ν": "N", "Ξ": "X",
    "Ο": "O", "Π": "P", "Ρ": "R", "Σ": "S", "Τ": "T", "Υ": "Y", "Φ": "F",
    "Χ": "CH", "Ψ": "PS", "Ω": "O", "Ϊ": "I", "Ϋ": "Y",
}

# Legal-form suffixes to strip (Latin and Greek), longest first.
_SUFFIXES = [
    "PUBLIC COMPANY LIMITED", "PUBLIC LIMITED", "PUBLIC LTD", "LIMITED", "PUBLIC",
    "LTD", "LLC", "PLC", "CO LTD", "AND SONS", "SONS", "AND CO", "CO",
    "ΛΙΜΙΤΕΔ", "ΛΤΔ", "ΔΗΜΟΣΙΑ", "ΚΑΙ ΥΙΟΙ", "ΥΙΟΙ",
]


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def transliterate_greek(s):
    s = strip_accents(s.upper())
    for gr, la in _DIGRAPHS:
        s = s.replace(gr, la)
    return "".join(_LETTERS.get(c, c) for c in s)


def normalize_name(name):
    """Uppercase, transliterate, strip legal suffixes & punctuation, token-sort."""
    s = transliterate_greek(name or "")
    s = s.replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # strip legal suffixes at the end (possibly several: "... AND SONS LTD")
    changed = True
    while changed:
        changed = False
        for suf in _SUFFIXES:
            suf_t = re.sub(r"[^A-Z0-9 ]+", " ", transliterate_greek(suf)).strip()
            if s.endswith(" " + suf_t):
                s = s[: -len(suf_t) - 1].rstrip()
                changed = True
    tokens = sorted(t for t in s.split() if t)
    return " ".join(tokens)


def normalize_id(value):
    """VAT / TIN normalization: uppercase, alphanumeric only."""
    return re.sub(r"[^A-Z0-9]+", "", (value or "").upper())


def vat_core(value):
    """Digit core of a VAT/TIN so 'CY10012321Q' matches '10012321Q' records."""
    v = normalize_id(value)
    v = re.sub(r"^CY", "", v)
    return v


def normalize_phone(value):
    digits = re.sub(r"\D+", "", value or "")
    # drop country prefix variants of Cyprus numbers
    if digits.startswith("00357"):
        digits = digits[5:]
    elif digits.startswith("357") and len(digits) > 8:
        digits = digits[3:]
    return digits


def split_ibans(value):
    return sorted({p.strip().replace(" ", "").upper() for p in (value or "").split(";") if p.strip()})


def iban_valid(iban):
    """mod-97 check."""
    s = re.sub(r"\s+", "", (iban or "").upper())
    if len(s) < 5 or not s[:2].isalpha():
        return False
    rearranged = s[4:] + s[:4]
    digits = "".join(str(ord(c) - 55) if c.isalpha() else c for c in rearranged)
    try:
        return int(digits) % 97 == 1
    except ValueError:
        return False
