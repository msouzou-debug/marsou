"""Staff mapping: which clinic (unit) each professional worked in, and how
the month's ΟΑΥ payment is therefore split.

The mental-health services have a clinic structure that the claims files do
not carry: a professional works, say, 3/5 of the week in one Ε.Ι.Ψ.Υ. and
2/5 in another.  ΟΑΥ pays the UNIT (one cheque per unit), but SAP is posted
per CLINIC, so the payment has to be re-split using the monthly staff roster
the service maintains.

Nothing here guesses money: a professional the roster does not cover stays in
an explicit «no roster row» bucket, and a fuzzy name match is accepted only
when it is both close and unique.
"""
from __future__ import annotations

import difflib
import io
import math
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from .models import GREEK_MONTHS, MONTH_NAMES_EL, norm_label

# Greek -> Latin, digraphs first.  ΟΑΥ prints professionals as
# «ΟΘΩΝ ΤΣΙΡΚΑΣ / OTHON TSIRKAS» and sometimes only in Latin, while the
# roster is Greek only — so both sides are reduced to one alphabet.
_TRANSLIT = [("ΟΥ", "OU"), ("ΑΥ", "AV"), ("ΕΥ", "EV"), ("ΜΠ", "B"), ("ΝΤ", "D"),
             ("ΓΚ", "G"), ("ΤΣ", "TS"), ("ΤΖ", "TZ"), ("Θ", "TH"), ("Χ", "CH"),
             ("Ψ", "PS"), ("Ξ", "X"), ("Φ", "F"), ("Ω", "O"), ("Η", "I"),
             ("Υ", "Y"), ("Β", "V"), ("Γ", "G"), ("Δ", "D"), ("Ζ", "Z"),
             ("Λ", "L"), ("Μ", "M"), ("Ν", "N"), ("Π", "P"), ("Ρ", "R"),
             ("Σ", "S"), ("Τ", "T"), ("Κ", "K"), ("Α", "A"), ("Ε", "E"),
             ("Ι", "I"), ("Ο", "O")]

# a fuzzy match is only accepted this close AND only when it is unique —
# money is never attributed on a maybe
FUZZY_MIN = 0.92


def translit(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s)).upper()
    s = "".join(c for c in s if not unicodedata.combining(c))
    for gr, la in _TRANSLIT:
        s = s.replace(gr, la)
    return re.sub(r"[^A-Z ]", " ", s)


def name_key(s: str) -> tuple:
    """Order-insensitive name key: «ΜΑΡΙΑ ΠΑΛΕΞΑ ΧΑΡΑΛΑΜΠΙΔΗ» and
    «ΧΑΡΑΛΑΜΠΙΔΗ ΠΑΛΕΞΑ ΜΑΡΙΑ» compare equal."""
    return tuple(sorted(t for t in translit(s).split() if len(t) > 1))


# a placement fraction («3/5»), NOT a date («1/1/2025») and not a ratio with
# an implausible denominator
_FRACTION_RE = re.compile(r"(?<![\d/])(\d{1,2})\s*/\s*([1-9]|10)(?![\d/])")
# noise that follows a clinic name in the roster cells
_PLACEMENT_TAIL_RE = re.compile(
    r"\s*(?:,|·|\(|\bΚΑΙ\s+(?:ΔΥΟ|ΤΡΕΙΣ|ΜΙΑ|\d)|\bΑΠΟ\b|\bΕΩΣ\b).*$", re.I)
_TIME_WORDS = {"ΠΡΩΙ", "ΑΠΟΓΕΥΜΑ", "ΒΡΑΔΥ", "ΚΑΙ", "AM", "PM"}


def clinic_key(name: str) -> str:
    """Grouping key for a clinic: «Ε.Ι.Ψ.Υ. ΛΑΡΝΑΚΑΣ», «Ε.Ι. Ψ.Υ. ΛΑΡΝΑΚΑΣ»
    and «Ε.Ι.Ψ.Υ.ΛΑΡΝΑΚΑΣ» are one clinic written three ways."""
    up = unicodedata.normalize("NFD", str(name)).upper()
    up = "".join(c for c in up if not unicodedata.combining(c))
    return re.sub(r"[^Α-ΩA-Z0-9]", "", up)


# accented Greek -> plain, length-preserving so a cut index found on the
# folded copy still applies to the original text
_ACCENTS = str.maketrans("ΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰ", "ΑΕΗΙΟΥΩΙΥαεηιουωιυιυ")


def _clean_clinic(raw: str) -> str:
    name = re.sub(r"\(.*?\)", " ", raw)
    cut = _PLACEMENT_TAIL_RE.search(name.translate(_ACCENTS))
    if cut:
        name = name[:cut.start()]
    name = re.sub(r"^\s*(?:και|and)\s+", "", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip(" ,.·-)/")
    words = [w for w in name.split() if w.upper().strip(".,") not in _TIME_WORDS]
    name = " ".join(words).strip(" ,.·-")
    return name[:60]


def parse_placements(text) -> list[tuple[str, float]]:
    """«3/5 Ε.Ι.Ψ.Υ. ΛΑΡΝΑΚΑΣ και 2/5 Ψ.Ν.Α (21)» -> [(unit, weight), ...].

    Weights are normalised to sum to 1: the roster sometimes states fractions
    that add up to more than a full week (a professional covering an extra
    clinic), and the split still has to distribute exactly 100% of the money.
    A cell with no fraction at all («ΔΙΟΙΚΗΣΗ», «ΑΔΕΙΑ ΑΣΘΕΝΕΙΑΣ») is one
    placement at full weight."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t or t.lower() == "nan":
        return []
    marks = list(_FRACTION_RE.finditer(t))
    if not marks:
        return [(_clean_clinic(t) or t, 1.0)]
    out: list[tuple[str, float]] = []
    for i, m in enumerate(marks):
        denom = int(m.group(2)) or 1
        weight = int(m.group(1)) / denom
        end = marks[i + 1].start() if i + 1 < len(marks) else len(t)
        name = _clean_clinic(t[m.end():end])
        if name:
            out.append((name, weight))
    total = sum(w for _n, w in out)
    if not total:
        return [(t, 1.0)]
    return [(n, w / total) for n, w in out]


@dataclass
class StaffRow:
    name: str
    key: tuple
    placements: list[tuple[str, float]]
    personnel_area: str = ""
    subarea: str = ""
    source_month: str = ""     # the roster column the placement was read from


@dataclass
class StaffMapping:
    """One or more monthly rosters, merged.  ΟΑΥ's mental-health service keeps
    a separate roster per profession (psychiatrists, psychologists, nurses…),
    so a batch may carry several files."""
    rows: list[StaffRow] = field(default_factory=list)
    month_columns: list[str] = field(default_factory=list)
    sheets: list[str] = field(default_factory=list)

    @property
    def by_key(self) -> dict:
        return {r.key: r for r in self.rows}

    def merge(self, other: "StaffMapping") -> "StaffMapping":
        seen = {r.key for r in self.rows}
        self.rows += [r for r in other.rows if r.key not in seen]
        self.month_columns += [c for c in other.month_columns
                               if c not in self.month_columns]
        self.sheets += other.sheets
        return self


_ROSTER_HEADERS = ("PERSONAL ID", "FIRST NAME", "LAST NAME")


def _month_column(columns: list, year: Optional[int], month: Optional[int]
                  ) -> tuple[Optional[int], list[int]]:
    """Index of the column for (year, month) and every month column, in order.

    Roster headers are «ΙΑΝΟΥΑΡΙΟΣ 2025» … or bare «ΙΑΝΟΥΑΡΙΟΣ»; when the year
    is stated it must match, otherwise the month name alone decides."""
    months: list[tuple[int, Optional[int], int]] = []   # (idx, year, month)
    for j, c in enumerate(columns):
        up = norm_label(str(c))
        hit = next((m for name, m in GREEK_MONTHS.items() if up.startswith(name)), None)
        if hit is None:
            continue
        ym = re.search(r"(20\d\d)", up)
        months.append((j, int(ym.group(1)) if ym else None, hit))
    want = None
    for j, y, m in months:
        if m == month and (y is None or year is None or y == year):
            want = j
            break
    return want, [j for j, _y, _m in months]


def extract_staff_mapping(data: bytes, year: Optional[int] = None,
                          month: Optional[int] = None) -> StaffMapping:
    """Read every sheet that looks like a roster.  The placement cell for the
    month may be «√» meaning «unchanged» — the last explicit value to its
    LEFT is carried forward, which is how the service maintains the file."""
    head = data[:8]
    engine = "xlrd" if head.startswith(b"\xd0\xcf\x11\xe0") else "openpyxl"
    sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None,
                           engine=engine, dtype=object)
    out = StaffMapping()
    for sheet_name, df in sheets.items():
        if df.empty:
            continue
        header_row = None
        for i in range(min(6, len(df))):
            joined = " | ".join(norm_label(str(v)) for v in df.iloc[i]
                                if v is not None and str(v) != "nan")
            if all(h in joined for h in _ROSTER_HEADERS):
                header_row = i
                break
        if header_row is None:
            continue
        cols = [str(v).strip() if v is not None and str(v) != "nan" else ""
                for v in df.iloc[header_row]]
        body = df.iloc[header_row + 1:]
        idx = {norm_label(c): j for j, c in enumerate(cols) if c}
        want, month_cols = _month_column(cols, year, month)
        if want is None and month_cols:
            want = month_cols[-1]          # newest column when the month is unknown
        out.month_columns += [cols[j] for j in month_cols]
        out.sheets.append(sheet_name)
        for _, row in body.iterrows():
            first = str(row.iloc[idx.get("FIRST NAME", 1)] or "").strip()
            last = str(row.iloc[idx.get("LAST NAME", 2)] or "").strip()
            if not first or first == "nan" or last == "nan":
                continue
            value = row.iloc[want] if want is not None else None
            text = str(value or "").strip()
            source = cols[want] if want is not None else ""
            if text in ("", "nan", "√", "V", "v", "-") and month_cols:
                # «√» = unchanged: walk left to the last stated placement
                for j in reversed([c for c in month_cols if want is None or c < want]):
                    prev = str(row.iloc[j] or "").strip()
                    if prev not in ("", "nan", "√", "V", "v", "-"):
                        text, source = prev, cols[j]
                        break
            name = f"{first} {last}"
            out.rows.append(StaffRow(
                name=name, key=name_key(name), placements=parse_placements(text),
                personnel_area=str(row.iloc[idx.get("PERSONNEL AREA", 5)] or "").strip()
                if "PERSONNEL AREA" in idx else "",
                subarea=str(row.iloc[idx.get("PERSONNEL SUBAREA", 6)] or "").strip()
                if "PERSONNEL SUBAREA" in idx else "",
                source_month=source))
    if not out.rows:
        raise ValueError("Μητρώο προσωπικού: δεν βρέθηκαν γραμμές "
                         "(Personal ID / First Name / Last Name)")
    return out


def match_professional(display_name: str, mapping: StaffMapping
                       ) -> tuple[Optional[StaffRow], float]:
    """(roster row, score) for a claims-file professional name.

    ΟΑΥ prints «ΓΡΕΓΚ ΕΛΛΗΝΙΚΑ / LATIN» (sometimes only one half), so every
    half is tried.  A fuzzy hit counts only when it clears FUZZY_MIN and is
    the ONLY candidate that does — otherwise the professional is reported
    unmatched rather than paid to the wrong clinic."""
    halves = [p for p in str(display_name).split("/") if p.strip()] or [display_name]
    by_key = mapping.by_key
    for half in halves:
        row = by_key.get(name_key(half))
        if row is not None:
            return row, 1.0
    best: list[tuple[float, StaffRow]] = []
    for half in halves:
        probe = " ".join(name_key(half))
        for row in mapping.rows:
            score = difflib.SequenceMatcher(None, probe, " ".join(row.key)).ratio()
            if score >= FUZZY_MIN:
                best.append((score, row))
    if not best:
        return None, max((difflib.SequenceMatcher(
            None, " ".join(name_key(h)), " ".join(r.key)).ratio()
            for h in halves for r in mapping.rows), default=0.0)
    best.sort(key=lambda t: -t[0])
    winners = {id(r) for s, r in best if abs(s - best[0][0]) < 1e-9}
    if len(winners) > 1:
        return None, best[0][0]           # ambiguous: never guess
    return best[0][1], best[0][0]


def share_round(x: float) -> float:
    """Half-away-from-zero to the cent, computed identically in both ports.

    Python rounds halves to even and JavaScript rounds them up, so an exact
    midpoint (7.512,49 ÷ 2) would put a stray cent on a different clinic in
    the browser than on the server.  One formula, one answer."""
    sign = -1.0 if x < 0 else 1.0
    return sign * math.floor(abs(x) * 100 + 0.5) / 100


@dataclass
class ClinicShare:
    """One professional's share of one clinic, for one unit's cheque."""
    unit: str              # the ΟΑΥ provider (the cheque)
    clinic: str            # the clinic from the roster
    segment: str
    speciality: str
    professional: str
    weight: float
    amount: float
    matched: bool = True
    note: str = ""


def allocate_by_clinic(by_doctor: list, mapping: Optional[StaffMapping],
                       unit_label: str = "") -> list[ClinicShare]:
    """Split each professional's amount across the clinics the roster puts
    them in.  Professionals with no roster row keep their whole amount in a
    single, clearly-labelled «no roster row» share — never dropped, never
    spread across clinics."""
    out: list[ClinicShare] = []
    for seg, spec, doctor, amount in by_doctor or []:
        row, score = (match_professional(doctor, mapping)
                      if mapping and mapping.rows else (None, 0.0))
        if row is None or not row.placements:
            note = ("Δεν βρέθηκε στο μητρώο προσωπικού (no roster row)"
                    if row is None else
                    "Το μητρώο δεν δηλώνει κλινική για τον μήνα (roster cell empty)")
            if row is None and score:
                # floor(x+0.5), not %-format: Python rounds halves to even and
                # JS rounds them up, and the note must read the same in both
                note += f" — πλησιέστερο ταίριασμα {math.floor(score * 100 + 0.5):.0f}%"
            out.append(ClinicShare(
                unit=unit_label, clinic="ΧΩΡΙΣ ΑΝΤΙΣΤΟΙΧΙΣΗ (unmapped)",
                segment=seg or "", speciality=spec or "", professional=doctor or "",
                weight=1.0, amount=share_round(amount), matched=False, note=note))
            continue
        # distribute to the cent: the last clinic absorbs the rounding
        allocated = 0.0
        for i, (clinic, weight) in enumerate(row.placements):
            share = (share_round(amount - allocated)
                     if i == len(row.placements) - 1 else share_round(amount * weight))
            allocated = share_round(allocated + share)
            out.append(ClinicShare(
                unit=unit_label, clinic=clinic, segment=seg or "",
                speciality=spec or "", professional=doctor or "",
                weight=weight, amount=share, matched=True,
                note="" if score == 1.0 else
                     f"Ταίριασμα κατά προσέγγιση "
                     f"{math.floor(score * 100 + 0.5):.0f}% με «{row.name}»"))
    return out


# ------------------------------------------------------- SAP cost centres

@dataclass
class CostCentreRow:
    clinic: str
    cost_centre: str = ""
    internal_order: str = ""
    text: str = ""
    speciality: str = ""


@dataclass
class CostCentreMap:
    rows: list[CostCentreRow] = field(default_factory=list)
    company_code: str = ""

    def find(self, clinic: str, speciality: str = "") -> Optional[CostCentreRow]:
        want = norm_label(clinic)
        spec = norm_label(speciality)
        exact = [r for r in self.rows if norm_label(r.clinic) == want]
        # a row that also names a speciality wins over a clinic-only row, so
        # the lookup works whether the internal order belongs to the clinic
        # or to the professional category
        for r in exact:
            if r.speciality and norm_label(r.speciality) == spec:
                return r
        for r in exact:
            if not r.speciality:
                return r
        return exact[0] if exact else None


_CC_CLINIC = ("ΚΛΙΝΙΚΗ", "CLINIC", "ΜΟΝΑΔΑ", "UNIT", "ΤΟΠΟΘΕΤΗΣΗ")
_CC_CENTRE = ("ΚΕΝΤΡΟ ΚΟΣΤΟΥΣ", "COST CENTRE", "COST CENTER", "KOSTL")


def extract_cost_centres(data: bytes) -> CostCentreMap:
    """Optional lookup: clinic -> SAP cost centre / internal order / text.

    Accepted either as a sheet inside the roster workbook or as its own file.
    Without it the SAP sheet is still produced, with the code columns blank
    and every clinic that needs a code listed — nothing is invented."""
    head = data[:8]
    engine = "xlrd" if head.startswith(b"\xd0\xcf\x11\xe0") else "openpyxl"
    sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None,
                           engine=engine, dtype=object)
    out = CostCentreMap()
    for _name, df in sheets.items():
        if df.empty:
            continue
        header_row = None
        for i in range(min(8, len(df))):
            joined = " | ".join(norm_label(str(v)) for v in df.iloc[i]
                                if v is not None and str(v) != "nan")
            if any(c in joined for c in _CC_CLINIC) and any(c in joined for c in _CC_CENTRE):
                header_row = i
                break
        if header_row is None:
            continue
        cols = [norm_label(str(v)) for v in df.iloc[header_row]]

        def col(*needles) -> Optional[int]:
            for needle in needles:
                for j, c in enumerate(cols):
                    if needle in c:
                        return j
            return None

        jc, jk = col(*_CC_CLINIC), col(*_CC_CENTRE)
        jo = col("ΕΣΩΤΕΡΙΚΗ ΕΝΤΟΛΗ", "INTERNAL ORDER", "AUFNR")
        jt = col("ΚΕΙΜΕΝΟ", "TEXT", "SGTXT")
        js = col("ΕΙΔΙΚΟΤΗΤΑ", "SPECIALITY", "SPECIALTY")
        jb = col("ΕΤΑΙΡΕΙΑ", "COMPANY", "BUKRS")
        if jc is None or jk is None:
            continue
        for _, row in df.iloc[header_row + 1:].iterrows():
            clinic = str(row.iloc[jc] or "").strip()
            if not clinic or clinic == "nan":
                continue
            def cell(j):
                if j is None:
                    return ""
                v = row.iloc[j]
                return "" if v is None or str(v) == "nan" else str(v).strip().split(".")[0]
            out.rows.append(CostCentreRow(
                clinic=clinic, cost_centre=cell(jk), internal_order=cell(jo),
                text=str(row.iloc[jt]).strip() if jt is not None
                     and str(row.iloc[jt]) != "nan" else "",
                speciality=str(row.iloc[js]).strip() if js is not None
                           and str(row.iloc[js]) != "nan" else ""))
            if jb is not None and not out.company_code:
                out.company_code = cell(jb)
    return out


MONTH_EN = ["", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
            "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]


def month_label(year: Optional[int], month: Optional[int]) -> str:
    if not year or not month:
        return ""
    return f"{MONTH_EN[month]} {year}"


def greek_month_label(year: Optional[int], month: Optional[int]) -> str:
    if not year or not month:
        return ""
    return f"{MONTH_NAMES_EL[month]} {year}"
