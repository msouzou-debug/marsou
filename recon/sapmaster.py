"""OKYπY's own SAP master data — company codes, the cost-centre master and the
chart of accounts — read straight from the export finance maintains.

This is the piece the ΟΑΥ reports cannot supply.  ΟΑΥ pays a hospital and
names its clinics in English («RENAL DISEASES»); SAP posts to a Greek cost
centre inside one company code («1064003402 ΝΕΦΡΟΛΟΓΙΚΗ-ΘΑΛΑΜΟΣ»), and each
revenue stream has its own HIO account.  Nothing here invents a code: a line
that cannot be matched uniquely comes out blank and is listed for a human.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from .models import norm_label

# ΟΑΥ's F-code -> the SAP company code that posts it.  Read off the master's
# own «Company Codes» sheet; kept here so the mapping is visible and reviewable
# rather than guessed from a name match at run time.
COMPANY_CODES = {
    "F1054": "1020",   # ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ -> ΓΝ Λευκωσίας
    "F1050": "1021",   # ΜΑΚΑΡΕΙΟ                     -> ΝΑΜΙΙΙ
    "F1047": "1030",   # ΓΝ ΛΕΜΕΣΟΥ                   -> ΓΝ Λεμεσού
    "F1025": "1031",   # ΓΝ ΠΑΦΟΥ                     -> ΓΝ Πάφου
    "F1055": "1032",   # ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ       -> Ν Τροόδους (confirmed)
    "F1026": "1033",   # ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΗΣ ΧΡΥΣΟΧΟΥΣ   -> Ν Πόλης Χρυσοχούς
    "F1048": "1040",   # ΓΝ ΛΑΡΝΑΚΑΣ                  -> ΓΝ Λάρνακας
    "F1049": "1041",   # ΓΝ ΑΜΜΟΧΩΣΤΟΥ               -> ΓΝ Αμμοχώστου
}
MENTAL_HEALTH_COMPANY = "1003"          # ΔΥΨΥ — every mental-health unit

# The HIO revenue accounts, by what the line actually is.  Each one is checked
# against the uploaded chart of accounts before it is written.
REVENUE_ACCOUNTS = {
    "inpatient_drg": "412001",      # HIO In-Patient Fees
    "inpatient_daily": "412005",    # HIO Day Care Fees
    "inpatient_z": "412007",        # HIO Catalogue Z Items
    "ae": "412003",                 # HIO TAEP Fees
    "outpatient": "412002",         # HIO Out-Patient Fees
    "capitation": "412000",         # HIO - Capitation Fees
    "quality": "412008",            # HIO Quality Criteria
    "oncall": "412009",             # HIO On-call clinics
    "vaccines": "412010",           # HIO Vaccines
    "pharma": "412006",             # HIO Drugs Phase B
}

# ΟΑΥ's English speciality -> the stem SAP uses in the cost-centre name.  Only
# unambiguous pairs are listed; anything else stays unmatched on purpose.
SPECIALTY_GREEK = {
    "CARDIOLOGY": "ΚΑΡΔΙΟΛΟΓΙΚ",
    "GENERAL SURGERY": "ΧΕΙΡΟΥΡΓΙΚΗ",
    "GASTROENTEROLOGY": "ΓΑΣΤΡΕΝΤΕΡΟΛΟΓΙΚ",
    "HAEMATOLOGY": "ΑΙΜΑΤΟΛΟΓΙΚ",
    "HEMATOLOGY": "ΑΙΜΑΤΟΛΟΓΙΚ",
    "RENAL DISEASES": "ΝΕΦΡΟΛΟΓΙΚ",
    "NEPHROLOGY": "ΝΕΦΡΟΛΟΓΙΚ",
    "DERMATO-VENEREOLOGY": "ΔΕΡΜΑΤΟΛΟΓΙΚ",
    "DERMATOLOGY": "ΔΕΡΜΑΤΟΛΟΓΙΚ",
    "NEUROLOGY": "ΝΕΥΡΟΛΟΓΙΚ",
    "NEUROLOGICAL SURGERY": "ΝΕΥΡΟΧΕΙΡΟΥΡΓΙΚ",
    "OBSTETRICS - GYNAECOLOGY": "ΓΥΝΑΙΚΟΛΟΓΙΚ",
    "OBSTETRICS-GYNAECOLOGY": "ΓΥΝΑΙΚΟΛΟΓΙΚ",
    "GYNAECOLOGY": "ΓΥΝΑΙΚΟΛΟΓΙΚ",
    "PAEDIATRICS": "ΠΑΙΔΙΑΤΡΙΚ",
    "PEDIATRICS": "ΠΑΙΔΙΑΤΡΙΚ",
    "OPHTHALMOLOGY": "ΟΦΘΑΛΜΟΛΟΓΙΚ",
    "INTERNAL MEDICINE": "ΠΑΘΟΛΟΓΙΚ",
    "ORTHOPAEDICS": "ΟΡΘΟΠΑΙΔΙΚ",
    "ORTHOPEDICS": "ΟΡΘΟΠΑΙΔΙΚ",
    "UROLOGY": "ΟΥΡΟΛΟΓΙΚ",
    "RESPIRATORY MEDICINE": "ΠΝΕΥΜΟΝΟΛΟΓΙΚ",
    "RHEUMATOLOGY": "ΡΕΥΜΑΤΟΛΟΓΙΚ",
    "OTORHINOLARYNGOLOGY": "ΩΡΛ",
    "PLASTIC SURGERY": "ΠΛΑΣΤΙΚΗ",
    "VASCULAR SURGERY": "ΑΓΓΕΙΟΧΕΙΡΟΥΡΓΙΚ",
    "DIAGNOSTIC RADIOLOGY": "ΑΚΤ",
    "PHYSIOTHERAPY": "ΦΥΣΙΟΘΕΡΑΠΕΥΤΗΡΙΟ",
    # whole-stream lines, which are not a clinical speciality at all
    "A&E": "ΤΑΕΠ",
    "ACCIDENT & EMERGENCY": "ΤΑΕΠ",
    "ΤΑΕΠ": "ΤΑΕΠ",
    "PHARMA": "ΦΑΡΜΑΚΕΙΟ",
    "ΦΑΡΜΑΚΑ": "ΦΑΡΜΑΚΕΙΟ",
    "HEMODIALYSIS": "ΝΕΦ-ΑΙΜΟΚΑΘΑΡΣΗ",
    "ΑΙΜΟΚΑΘΑΡΣΗ": "ΝΕΦ-ΑΙΜΟΚΑΘΑΡΣΗ",
    # ΟΑΥ pays these two as one number with no speciality of their own —
    # they post to the outpatient clinics generally
    "NURSES MIDWIVES": "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ",
    "ΝΟΣΗΛΕΥΤΕΣ": "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ",
    "ALLIED HEALTH": "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ",
    "ΑΛΛΟΙ ΕΠΑΓΓΕΛΜΑΤΙΕΣ": "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ",
    "INFECTIOUS DISEASES": "ΤΜΗΜΑ ΛΟΙΜΩΞΕΩΝ",
    "ΛΟΙΜΩΞΕΩΝ": "ΤΜΗΜΑ ΛΟΙΜΩΞΕΩΝ",
    # the outpatient bucket's own leftovers — quality criteria, reimbursement
    # adjustments, satellite-supplier cheques, the OS reconciling difference:
    # none is a clinical speciality, all are outpatient
    "OUTPATIENT": "ΕΞ.ΙΑΤΡΕΙΑ-ΓΕΝΙΚΑ",
    "PERSONAL DOCTORS": "ΠΙ ΕΝΗΛΙΚΩΝ",
    "ΠΡΟΣΩΠΙΚΟΙ ΙΑΤΡΟΙ": "ΠΙ ΕΝΗΛΙΚΩΝ",
}

# which flavour of a clinic's cost centre a stream posts to
_VARIANTS = {
    "ward": ("ΘΑΛ",),               # ΘΑΛΑΜΟΣ / ΘΑΛ Α / Θαλ. Α — inpatient
    "daycare": ("ΗΦ", "Η.Φ."),      # ημερήσια φροντίδα — daily treatments
    "clinic": ("ΕΙ",),              # εξωτερικά ιατρεία — outpatient specialists
    "general": ("ΓΕΝΙΚΑ", "ΓΕΝ"),
}


@dataclass
class CostCentre:
    company: str
    code: str
    name: str


@dataclass
class SapMaster:
    companies: dict = field(default_factory=dict)        # code -> description
    cost_centres: list = field(default_factory=list)     # CostCentre
    accounts: dict = field(default_factory=dict)         # G/L -> long text

    def account(self, key: str) -> tuple[str, str]:
        """The HIO revenue account for a kind of line, checked against the
        uploaded chart of accounts — an account the chart does not carry is
        NOT written."""
        code = REVENUE_ACCOUNTS.get(key, "")
        if code and code in self.accounts:
            return code, self.accounts[code]
        return "", ""

    def centres_for(self, company: str) -> list:
        return [c for c in self.cost_centres if c.company == company]

    def find_centre(self, company: str, specialty: str,
                    variant: str = "general") -> Optional[CostCentre]:
        """ΟΑΥ's English speciality + the stream's flavour -> one cost centre
        of this company, or None.  Never returns a guess: the stem must match
        and, once the flavour is applied, exactly one centre must remain."""
        stem = _stem_for(specialty)
        if not stem or not company:
            return None
        # the stem must START the centre's name: «ΝΕΥΡΟΧΕΙΡΟΥΡΓΙΚΗ» contains
        # «ΧΕΙΡΟΥΡΓΙΚΗ» but is not general surgery
        hits = [c for c in self.centres_for(company)
                if _fold(c.name).startswith(stem)]
        if not hits:
            return None
        # a centre NAMED exactly as the stem is that stream's own centre —
        # «ΤΑΕΠ» is not «ΚΩΔΙΚΟΠΟΙΗΣΗ ΤΑΕΠ»
        exact = [c for c in hits if _fold(c.name) == stem]
        if len(exact) == 1:
            return exact[0]
        for key in (variant, "general"):
            marks = _VARIANTS.get(key, ())
            picked = [c for c in hits if _has_variant(_tail(c.name, stem), marks)]
            if len(picked) == 1:
                return picked[0]
            if len(picked) > 1:
                # a clinic split across «ΘΑΛ Α» and «ΘΑΛ Β» books to Α
                alpha = [c for c in picked if _tail(c.name, stem).endswith("Α")]
                if len(alpha) == 1:
                    return alpha[0]
                return None       # still ambiguous — a human decides
        return hits[0] if len(hits) == 1 else None


    def why_no_centre(self, company: str, specialty: str,
                      variant: str = "general") -> str:
        """Why a line could not be coded — so the alert is a diagnosis rather
        than a list to stare at."""
        if not company:
            return "χωρίς εταιρεία (no company code)"
        stem = _stem_for(specialty)
        if not stem:
            return "άγνωστη ειδικότητα (speciality not in the dictionary)"
        hits = [c for c in self.centres_for(company)
                if _fold(c.name).startswith(stem)]
        if not hits:
            return "κανένα κέντρο με αυτό το όνομα (no such centre in SAP)"
        names = ", ".join(c.name for c in hits[:4])
        return f"ασαφές — υποψήφια: {names} (ambiguous)"


def _fold(s: str) -> str:
    return norm_label(str(s)).replace(".", "").replace(" ", "")


# the dictionary keyed the way a label actually normalises: norm_label turns
# «DERMATO-VENEREOLOGY» into «DERMATO VENEREOLOGY», so a hyphenated key would
# otherwise never match the speciality it was written for
_SPEC_NORM = {norm_label(k): v for k, v in SPECIALTY_GREEK.items()}


# longest name first, so «OBSTETRICS GYNAECOLOGY» is not read as
# «GYNAECOLOGY» and the answer does not depend on dictionary order
_SPEC_ORDER = sorted(_SPEC_NORM, key=len, reverse=True)


def _stem_for(specialty: str) -> str:
    """The whole label is searched, not a slice of it: ΟΑΥ writes clinics both
    bare («DERMATO-VENEREOLOGY») and inside a sentence («Ειδικοί Ιατροί —
    OPHTHALMOLOGY (OS)»), and any attempt to cut the speciality out first
    mangles the hyphenated ones."""
    up = norm_label(specialty)
    if up in _SPEC_NORM:
        return _fold(_SPEC_NORM[up])
    for name in _SPEC_ORDER:
        if name in up:
            return _fold(_SPEC_NORM[name])
    return ""


def _tail(name: str, stem: str) -> str:
    """What follows the speciality's own stem in the centre's name.

    The flavour must be read from THERE, not from the whole name: «ΟΦΘΑΛ»
    contains «ΘΑΛ» and «ΧΕΙΡΟΥΡΓΙΚΗ» contains «ΕΙ», so testing the whole name
    makes every ophthalmology centre look like a ward and every surgery centre
    like an outpatient clinic — and the match is then thrown out as ambiguous."""
    folded = _fold(name)
    i = folded.find(stem)
    return folded[i + len(stem):] if i >= 0 else folded


def _has_variant(name: str, marks: tuple) -> bool:
    folded = _fold(name)
    return any(_fold(m) in folded for m in marks)


_MASTER_SHEETS = ("COMPANY CODES", "COST CENTERS", "COST CENTRES",
                  "CHART OF ACCOUNTS")


def looks_like_sap_master(sheet_names) -> bool:
    seen = {norm_label(str(n)) for n in sheet_names}
    hits = sum(1 for want in _MASTER_SHEETS if any(want in s for s in seen))
    return hits >= 2


def extract_sap_master(data: bytes) -> SapMaster:
    """Read the export as it comes out of SAP: one sheet of company codes, one
    of cost centres, one chart of accounts.  Sheets are found by their headers,
    so a renamed tab still works."""
    head = data[:8]
    engine = "xlrd" if head.startswith(b"\xd0\xcf\x11\xe0") else "openpyxl"
    sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None,
                           engine=engine, dtype=object)
    out = SapMaster()
    for _name, df in sheets.items():
        if df.empty:
            continue
        header_row, cols = _header(df)
        if header_row is None:
            continue

        def col(*needles) -> Optional[int]:
            for needle in needles:
                for j, c in enumerate(cols):
                    if needle in c:
                        return j
            return None

        j_comp = col("COMP CODE", "COMPANY CODE")
        j_centre = col("COST CENTER", "COST CENTRE")
        j_acct = col("G L ACCOUNT", "GL ACCOUNT")
        j_name = col("NAME", "ΠΕΡΙΓΡΑΦΗ", "LONG TEXT")
        body = df.iloc[header_row + 1:]
        if j_centre is not None and j_comp is not None:
            for _, row in body.iterrows():
                company, code = _text(row, j_comp), _text(row, j_centre)
                if company and code:
                    out.cost_centres.append(
                        CostCentre(company, code, _text(row, j_name)))
        elif j_comp is not None:
            for _, row in body.iterrows():
                company = _text(row, j_comp)
                if company:
                    out.companies[company] = _text(row, j_name)
        elif j_acct is not None:
            for _, row in body.iterrows():
                acct = _text(row, j_acct)
                if acct:
                    out.accounts[acct] = _text(row, j_name)
    return out


def _header(df) -> tuple[Optional[int], list]:
    for i in range(min(6, len(df))):
        cols = [norm_label(str(v)) if v is not None and str(v) != "nan" else ""
                for v in df.iloc[i]]
        joined = " | ".join(cols)
        if any(k in joined for k in ("COMP CODE", "COMPANY CODE",
                                     "G L ACCOUNT", "GL ACCOUNT")):
            return i, cols
    return None, []


_NUM = re.compile(r"^\d+(\.0+)?$")


def _text(row, j: Optional[int]) -> str:
    if j is None:
        return ""
    v = row.iloc[j]
    if v is None or str(v) == "nan":
        return ""
    s = str(v).strip()
    return s.split(".")[0] if _NUM.match(s) else s


def company_for(hospital_code: Optional[str]) -> str:
    """The company code that posts this payee's cheque."""
    if not hospital_code:
        return ""
    return COMPANY_CODES.get(hospital_code, MENTAL_HEALTH_COMPANY)
