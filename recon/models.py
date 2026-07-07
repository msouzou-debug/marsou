"""Shared vocabulary: report types, hospitals, buckets, normalized schemas.

Everything downstream (identify -> extract -> checks -> build_xlsx) speaks
these types.  All amounts are floats in EUR; all text is UTF-8 Greek-safe.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ReportType(str, Enum):
    SRA = "sra"                              # Κατάσταση Πληρωμής / Remittance Advice (PDF)
    INPATIENT_SUMMARY = "inpatient_summary"  # Ενδ. Πληρωμένες Απαιτήσεις (Excel)
    CLAIMS_ALL = "claims_all"                # Πληρωμένες Απαιτήσεις «all» (Excel, DR SEGMENT)
    PHARMA_CLAIMS = "pharma_claims"          # Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ (Excel, TYPE)
    PHARMACIST_FEE = "pharmacist_fee"        # Αμοιβή Φαρμακοποιού (PDF)
    CAPITATION = "capitation"                # conditional
    QUALITY_CRITERIA = "quality_criteria"    # Ποιοτικά Κριτήρια (conditional)
    HEMODIALYSIS = "hemodialysis"            # conditional
    XML_ACTIVITY = "xml_activity"            # optional cross-check
    GL_EXTRACT = "gl_extract"                # optional cross-check (org-wide)
    IS_AUDITOR = "is_auditor"                # optional cross-check (org-wide)


REQUIRED_TYPES = [
    ReportType.SRA,
    ReportType.INPATIENT_SUMMARY,
    ReportType.CLAIMS_ALL,
    ReportType.PHARMA_CLAIMS,
    ReportType.PHARMACIST_FEE,
]
CONDITIONAL_TYPES = [ReportType.CAPITATION, ReportType.QUALITY_CRITERIA, ReportType.HEMODIALYSIS]
OPTIONAL_TYPES = [ReportType.XML_ACTIVITY, ReportType.GL_EXTRACT, ReportType.IS_AUDITOR]

# Org-wide reports carry no single hospital / are filtered at extract time,
# so they never trip the single-hospital gate.
ORG_WIDE_TYPES = {ReportType.GL_EXTRACT, ReportType.IS_AUDITOR}

REPORT_LABELS = {
    ReportType.SRA: "Κατάσταση Πληρωμής / SRA (Remittance Advice)",
    ReportType.INPATIENT_SUMMARY: "Ενδ. Πληρωμένες Απαιτήσεις (Inpatient summary)",
    ReportType.CLAIMS_ALL: "Πληρωμένες Απαιτήσεις «all» (Paid HCP claims)",
    ReportType.PHARMA_CLAIMS: "Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ (Pharma claims)",
    ReportType.PHARMACIST_FEE: "Αμοιβή Φαρμακοποιού (Pharmacist fee)",
    ReportType.CAPITATION: "Capitation Report (Κατά κεφαλήν αμοιβή)",
    ReportType.QUALITY_CRITERIA: "Ποιοτικά Κριτήρια (Quality criteria)",
    ReportType.HEMODIALYSIS: "Αιμοκάθαρση (Hemodialysis monthly report)",
    ReportType.XML_ACTIVITY: "XML activity export (Outpatient activity)",
    ReportType.GL_EXTRACT: "OKYPY ALL GL extract",
    ReportType.IS_AUDITOR: "IS Auditor Report (Inpatient detail)",
}

# F-code -> (Greek name, English name).  NB: «ΛΕΥΚΩΣΙΑΣ» alone also matches
# Makarios («... ΛΕΥΚΩΣΙΑΣ» appears inside its full name in some exports) —
# always match the full provider name or the F-code.
HOSPITALS = {
    "F1054": ("ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ", "Nicosia"),
    "F1050": ("ΜΑΚΑΡΕΙΟ ΝΟΣΟΚΟΜΕΙΟ", "Makarios"),
    "F1047": ("ΓΝ ΛΕΜΕΣΟΥ", "Limassol"),
    "F1048": ("ΓΝ ΛΑΡΝΑΚΑΣ", "Larnaca"),
    "F1049": ("ΓΝ ΑΜΜΟΧΩΣΤΟΥ", "Famagusta"),
    "F1025": ("ΓΝ ΠΑΦΟΥ", "Paphos"),
    "F1055": ("ΝΟΣΟΚΟΜΕΙΟ ΚΥΠΕΡΟΥΝΤΑΣ", "Kyperounta"),
    "F1026": ("ΝΟΣΟΚΟΜΕΙΟ ΠΟΛΗΣ ΧΡΥΣΟΧΟΥΣ", "Polis"),
}


# Provider-name matching tokens for org-wide detail reports (IS Auditor),
# whose names are long forms like «ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΑΜΜΟΧΩΣΤΟΥ (ΟΚΥπΥ)».
# (must-contain-any, must-NOT-contain) — Nicosia excludes Makarios explicitly.
HOSPITAL_NAME_TOKENS = {
    "F1054": (["ΛΕΥΚΩΣΙΑΣ"], ["ΜΑΚΑΡΕΙΟ"]),
    "F1050": (["ΜΑΚΑΡΕΙΟ"], []),
    "F1047": (["ΛΕΜΕΣ"], []),
    "F1048": (["ΛΑΡΝΑΚ"], []),
    "F1049": (["ΑΜΜΟΧΩΣΤ"], []),
    "F1025": (["ΠΑΦΟ"], []),
    "F1055": (["ΚΥΠΕΡΟΥΝΤ"], []),
    "F1026": (["ΧΡΥΣΟΧΟΥΣ"], []),
}


def hospital_name_matches(code: str, name: str) -> bool:
    up = strip_accents(name)
    any_tokens, not_tokens = HOSPITAL_NAME_TOKENS[code]
    return (any(t in up for t in any_tokens)
            and not any(t in up for t in not_tokens))


class Bucket(str, Enum):
    INPATIENT = "Inpatient"
    AE = "A&E"
    OUTPATIENT = "Outpatient"
    PHARMA = "Pharma"


BUCKET_ORDER = [Bucket.INPATIENT, Bucket.AE, Bucket.OUTPATIENT, Bucket.PHARMA]

GREEK_MONTHS = {
    "ΙΑΝΟΥΑΡΙΟΣ": 1, "ΙΑΝΟΥΑΡΙΟΥ": 1, "ΦΕΒΡΟΥΑΡΙΟΣ": 2, "ΦΕΒΡΟΥΑΡΙΟΥ": 2,
    "ΜΑΡΤΙΟΣ": 3, "ΜΑΡΤΙΟΥ": 3, "ΑΠΡΙΛΙΟΣ": 4, "ΑΠΡΙΛΙΟΥ": 4,
    "ΜΑΙΟΣ": 5, "ΜΑΙΟΥ": 5, "ΙΟΥΝΙΟΣ": 6, "ΙΟΥΝΙΟΥ": 6,
    "ΙΟΥΛΙΟΣ": 7, "ΙΟΥΛΙΟΥ": 7, "ΑΥΓΟΥΣΤΟΣ": 8, "ΑΥΓΟΥΣΤΟΥ": 8,
    "ΣΕΠΤΕΜΒΡΙΟΣ": 9, "ΣΕΠΤΕΜΒΡΙΟΥ": 9, "ΟΚΤΩΒΡΙΟΣ": 10, "ΟΚΤΩΒΡΙΟΥ": 10,
    "ΝΟΕΜΒΡΙΟΣ": 11, "ΝΟΕΜΒΡΙΟΥ": 11, "ΔΕΚΕΜΒΡΙΟΣ": 12, "ΔΕΚΕΜΒΡΙΟΥ": 12,
}

MONTH_NAMES_EL = ["", "Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος",
                  "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος",
                  "Νοέμβριος", "Δεκέμβριος"]

# Latin abbreviations for output filenames (OKYPY_HIO_F1049_MAR2026_...)
MONTH_ABBR = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL",
              "AUG", "SEP", "OCT", "NOV", "DEC"]


def strip_accents(s: str) -> str:
    """Uppercase + strip Greek diacritics, for tolerant label matching."""
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if not unicodedata.combining(c)).upper()


_SEP_RE = re.compile(r"[\s_\-./]+")


def norm_label(s: str) -> str:
    """Header/label comparison form: accent-stripped, uppercased, and all
    separator runs (space, _, -, ., /) collapsed to single spaces — so
    'DR_SEGMENT', 'Dr Segment' and 'DR-SEGMENT' all compare equal."""
    return _SEP_RE.sub(" ", strip_accents(s)).strip()


PHARMACIST_FEE_UNIT_PRICE = 1.60


@dataclass
class IdentifiedFile:
    filename: str
    data: bytes
    report_type: Optional[ReportType] = None
    hospital_code: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
    error: Optional[str] = None
    # for scanned SRAs: raw text so the UI can offer on-screen correction
    ocr_used: bool = False
    raw_text: Optional[str] = None
    # what the identifier actually read from the file (diagnostics panel)
    probe: Optional[str] = None


@dataclass
class SRALine:
    code: str
    description: str
    amount: float
    bucket: Bucket
    channel: str = ""       # payment channel (e.g. claims / capitation / adjustment)
    source_report: str = "" # which HIO report supports the line


@dataclass
class SRA:
    cheque_no: str
    stated_total: float
    lines: list[SRALine]
    hospital_code: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    # one entry per source SRA when several cheques are merged:
    # (cheque_no, lines_total, stated_total)
    parts: list[tuple[str, float, float]] = field(default_factory=list)

    @property
    def lines_total(self) -> float:
        return round(sum(l.amount for l in self.lines), 2)


@dataclass
class InpatientSummary:
    kanonika: float = 0.0
    kanonika_parap: float = 0.0
    exeidikevmena: float = 0.0
    exeid_parap: float = 0.0
    gennes: float = 0.0                      # Γέννες (births) — real months have it
    z_catalogue: float = 0.0
    other: dict[str, float] = field(default_factory=dict)  # unrecognised categories
    synolo: float = 0.0
    by_clinic: list["ClinicRow"] = field(default_factory=list)  # «per clinic» sheet

    @property
    def regular(self) -> float:
        return round(self.kanonika + self.kanonika_parap, 2)

    @property
    def specialized(self) -> float:
        return round(self.exeidikevmena + self.exeid_parap, 2)

    @property
    def computed_total(self) -> float:
        return round(self.kanonika + self.kanonika_parap + self.exeidikevmena
                     + self.exeid_parap + self.gennes + self.z_catalogue
                     + sum(self.other.values()), 2)


@dataclass
class ClinicRow:
    clinic: str
    fixed_fee: float = 0.0
    drg: float = 0.0
    total: float = 0.0


@dataclass
class ClaimsAll:
    by_segment: dict[str, float] = field(default_factory=dict)
    inpatient_by_clinic: list[ClinicRow] = field(default_factory=list)
    os_by_specialty: dict[str, float] = field(default_factory=dict)
    # (claim id, invoice date, amount) per inpatient row — used to name the
    # candidate old-period claims when claims-all ≠ Ενδ. Σύνολο
    inpatient_rows: list[tuple[str, str, float]] = field(default_factory=list)

    @property
    def total(self) -> float:
        return round(sum(self.by_segment.values()), 2)


@dataclass
class PharmaClaims:
    by_type: dict[str, float] = field(default_factory=dict)

    @property
    def total(self) -> float:
        return round(sum(self.by_type.values()), 2)


@dataclass
class PharmacistFee:
    packages: int
    unit_price: float
    amount: float
    invoice_id: str = ""

    @property
    def computed(self) -> float:
        return round(self.packages * self.unit_price, 2)


@dataclass
class GLExtract:
    regular_drg: float = 0.0       # 26001
    specialized: float = 0.0       # 26002
    z_catalogue: float = 0.0       # 26003 + 26007
    ae: float = 0.0                # 25801
    pharmacist_fee: float = 0.0    # 25501
    pharma_other: float = 0.0      # other 255xx
    outpatient: float = 0.0        # remaining clinical 25xxx (OS+NM+AP)
    capitation: float = 0.0        # account 51001001
    other: float = 0.0

    @property
    def inpatient(self) -> float:
        return round(self.regular_drg + self.specialized + self.z_catalogue, 2)


@dataclass
class ISAuditor:
    drg_fees: float = 0.0
    z_catalogue: float = 0.0
    normal: float = 0.0
    specialised: float = 0.0
    inpatient_total: float = 0.0


@dataclass
class XMLActivity:
    total: float = 0.0      # covers OS + NM + AP
    n_claims: int = 0


@dataclass
class SimpleReport:
    """Capitation / quality criteria / hemodialysis: a single total (+ lines)."""
    total: float = 0.0
    lines: list[tuple[str, float]] = field(default_factory=list)
