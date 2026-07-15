"""Δομές δεδομένων: γραμμές ονομαστικού πίνακα και σύνολα-ελέγχου επιστολής."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# Πεδία ποσών μιας γραμμής, με τη σειρά των στηλών G–K του φύλλου.
AMOUNT_FIELDS = ("basic", "tim", "auxisi", "bardia", "kyriaki")

AMOUNT_LABELS = {
    "basic": "Βασικοί Μισθοί",
    "tim": "Τιμαριθμικό Επίδομα",
    "auxisi": "Αύξηση Μισθού 1,5%",
    "bardia": "Επίδομα Βάρδιας",
    "kyriaki": "Επίδομα Κυριακής & Δημ. Αργίας",
}

GREEK_MONTHS = [
    "ΙΑΝΟΥΑΡΙΟΣ", "ΦΕΒΡΟΥΑΡΙΟΣ", "ΜΑΡΤΙΟΣ", "ΑΠΡΙΛΙΟΣ", "ΜΑΙΟΣ", "ΙΟΥΝΙΟΣ",
    "ΙΟΥΛΙΟΣ", "ΑΥΓΟΥΣΤΟΣ", "ΣΕΠΤΕΜΒΡΙΟΣ", "ΟΚΤΩΒΡΙΟΣ", "ΝΟΕΜΒΡΙΟΣ", "ΔΕΚΕΜΒΡΙΟΣ",
]


def strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )


def normalize_label(text: str) -> str:
    """Κεφαλαία χωρίς τόνους, για σύγκριση ελληνικών ετικετών."""
    return strip_accents(str(text)).upper().strip()


def normalize_month(text: str) -> str | None:
    """Επιστρέφει το κανονικό όνομα μήνα (π.χ. 'ΑΠΡΙΛΙΟΥ' -> 'ΑΠΡΙΛΙΟΣ')."""
    t = normalize_label(text)
    for m in GREEK_MONTHS:
        stem = m[:-2]  # ΑΠΡΙΛΙ, ΦΕΒΡΟΥΑΡΙ, ΜΑΙ ...
        if t.startswith(stem):
            return m
    return None


def parse_date(text: str):
    """Εξάγει datetime από κείμενο μορφής dd/mm/yyyy (και «ΑΠΟ 23/3/2026»)."""
    from datetime import datetime

    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", str(text or ""))
    if not m:
        return None
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year < 100:
        year += 2000
    try:
        return datetime(year, month, day)
    except ValueError:
        return None


def parse_amount(value) -> float:
    """Μετατροπή ποσού από κείμενο σε αριθμό (2 δεκαδικά).

    Δέχεται μορφές όπως '1.234,56', '1,234.56', '1234.56', '-', '', '(12,50)'.
    """
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    s = str(value).strip().replace("€", "").replace(" ", "")
    if s in ("", "-", "—", "–"):
        return 0.0
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    if s.startswith("-"):
        negative, s = True, s[1:]
    if "," in s and "." in s:
        # Το τελευταίο σύμβολο είναι ο δεκαδικός διαχωριστής.
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # Κόμμα ως δεκαδικό αν ακολουθούν 1-2 ψηφία, αλλιώς διαχωριστής χιλιάδων.
        if re.search(r",\d{1,2}$", s):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    elif s.count(".") > 1 or re.search(r"\.\d{3}$", s):
        s = s.replace(".", "")
    try:
        result = round(float(s), 2)
    except ValueError:
        raise ValueError(f"Μη αναγνωρίσιμο ποσό: {value!r}")
    return -result if negative else result


def cents(x: float) -> int:
    return int(round(x * 100))


# Αντιστοίχιση κειμένου ΠΑΡΑΤΗΡΗΣΕΩΝ -> κωδικός νοσηλευτηρίου (στήλη H του «Ανάλυση»).
# Η σειρά έχει σημασία: το ΜΑΚΑΡΙΟ πρέπει να ελεγχθεί πριν από τη γενική ΛΕΥΚΩΣΙΑ.
HOSPITAL_KEYWORDS = [
    ("ΜΑΚΑΡΙΟ", 1200),
    ("ΛΑΤΣΙΑ", 1400),
    ("ΑΜΜΟΧΩΣΤ", 3200),
    ("Κ.Ε.Μ", 3200),
    ("ΛΑΡΝΑΚΑ", 4100),
    ("ΠΟΛΕΜΙΔΙ", 5100),
    ("ΛΕΜΕΣ", 5100),
    ("ΠΑΦΟ", 6100),
    ("ΛΕΥΚΩΣΙΑ", 1400),  # Γ.Ν. Λευκωσίας, αφού αποκλειστεί το Μακάρειο
]


def hospital_from_remarks(remarks: str) -> int | None:
    """Κωδικός νοσηλευτηρίου από το κείμενο των παρατηρήσεων του PDF."""
    t = normalize_label(remarks)
    for key, code in HOSPITAL_KEYWORDS:
        if normalize_label(key) in t:
            return code
    return None


@dataclass
class TableRow:
    """Μία γραμμή του ονομαστικού πίνακα."""

    aa: str = ""
    aka: str = ""
    east: str = ""
    name: str = ""
    date: str = ""
    basic: float = 0.0
    tim: float = 0.0
    auxisi: float = 0.0
    bardia: float = 0.0
    kyriaki: float = 0.0
    remarks: str = ""
    adt: str = ""                # ΑΔΤ: δεν υπάρχει στο PDF — συμπληρώνεται από το ιστορικό
    hospital: int | None = None  # κωδικός νοσηλευτηρίου (από παρατηρήσεις ή ιστορικό)
    needs_review: bool = False
    review_reasons: list[str] = field(default_factory=list)

    @property
    def aka_norm(self) -> str:
        return re.sub(r"\D", "", str(self.aka)).lstrip("0")

    @property
    def is_analogia(self) -> bool:
        """Αναλογική/αναδρομική/διορθωτική γραμμή (όχι πλήρης μήνας)."""
        t = normalize_label(self.name + " " + self.remarks)
        if any(k in t for k in ("ΑΝΑΛΟΓΙΑ", "ΑΝΑΔΡΟΜΙΚ", "ΕΠΙΔΟΜΑΤΑ", "ΜΙΣΘΟΣ ")):
            return True
        # Γραμμές με ημερομηνία «ΑΠΟ ...» είναι αναλογίες μερικού μήνα.
        return "ΑΠΟ" in normalize_label(self.date)

    def dedupe_key(self) -> tuple:
        return (
            self.aka_norm,
            cents(self.basic), cents(self.tim), cents(self.auxisi),
            cents(self.bardia), cents(self.kyriaki),
        )

    def flag(self, reason: str) -> None:
        self.needs_review = True
        if reason not in self.review_reasons:
            self.review_reasons.append(reason)


@dataclass
class LetterTotals:
    """Τα 8 σύνολα-ελέγχου της συνοδευτικής επιστολής (σελίδα 1)."""

    basic: float = 0.0
    tim: float = 0.0
    auxisi: float = 0.0
    bardia: float = 0.0
    kyriaki: float = 0.0
    eisfora: float = 0.0      # Εισφορά Εργοδότη
    dioikitika: float = 0.0   # Διοικητικά Έξοδα 10%
    geniko: float = 0.0       # Γενικό Σύνολο
    minas_misthon: str = ""   # π.χ. ΑΠΡΙΛΙΟΣ
    minas_epidomaton: str = ""
    etos: str = ""
