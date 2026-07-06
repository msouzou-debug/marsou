"""Content-based file identification.

identify(filename, data) -> IdentifiedFile with report_type, hospital_code,
year, month.  The filename is NEVER trusted for identity — ΟΑΥ frequently
names the all-segments claims file "..._OS_...".  Everything is read from
the bytes: magic sniff -> per-format probes -> report-type rules from the
brief.
"""
from __future__ import annotations

import io
import re
from typing import Optional

import pandas as pd
from lxml import etree

from .models import (GREEK_MONTHS, HOSPITALS, IdentifiedFile, ReportType,
                     norm_label, strip_accents)

F_CODE_RE = re.compile(r"\bF10(?:25|26|47|48|49|50|54|55)\b")


# ---------------------------------------------------------------- sniffing

def sniff_format(data: bytes) -> str:
    head = data[:8]
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith(b"PK\x03\x04"):
        return "xlsx"
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        return "xls"
    stripped = data.lstrip(b"\xef\xbb\xbf \t\r\n")
    if stripped.startswith(b"<"):
        return "xml"
    return "unknown"


# ------------------------------------------------------- period / hospital

_MM_YYYY_RE = re.compile(r"\b(0?[1-9]|1[0-2])\s*[/.\-]\s*(20\d\d)\b")
_YYYY_MM_RE = re.compile(r"\b(20\d\d)\s*[-/.]\s*(0?[1-9]|1[0-2])\b(?!\s*[/.\-]\s*\d)")
_DD_MM_YYYY_RE = re.compile(r"\b([0-3]?\d)\s*/\s*(0?[1-9]|1[0-2])\s*/\s*(20\d\d)\b")
_MONTH_LABEL_RE = re.compile(r"ΜΗΝΑΣ\s*[:=]\s*(\d{1,2})\b")
_YEAR_LABEL_RE = re.compile(r"ΕΤΟΣ\s*[:=]\s*(20\d\d)\b")


def find_period(text: str) -> tuple[Optional[int], Optional[int]]:
    """(year, month) from free text: labeled «Μήνας: 3 / Έτος: 2026» first,
    then Greek month names, MM/YYYY, DD/MM/YYYY, YYYY-MM."""
    up = strip_accents(text)
    ml, yl = _MONTH_LABEL_RE.search(up), _YEAR_LABEL_RE.search(up)
    if ml and yl:
        return int(yl.group(1)), int(ml.group(1))
    for name, m in GREEK_MONTHS.items():
        if name in up:
            ym = re.search(re.escape(name) + r"\D{0,10}(20\d\d)", up)
            if ym:
                return int(ym.group(1)), m
            y = re.search(r"\b(20\d\d)\b", up)
            if y:
                return int(y.group(1)), m
    m = _DD_MM_YYYY_RE.search(text)
    if m:
        return int(m.group(3)), int(m.group(2))
    m = _MM_YYYY_RE.search(text)
    if m:
        return int(m.group(2)), int(m.group(1))
    m = _YYYY_MM_RE.search(text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def prev_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


_PAY_DATE_LINE_RE = re.compile(r"PAYMENT\s*DATE|ΗΜΕΡΟΜΗΝΙΑ\s*ΠΛΗΡΩΜΗΣ")


def find_service_period(text: str) -> tuple[Optional[int], Optional[int]]:
    """Service month for SRAs.  The SRA is ALWAYS dated one month after the
    month it settles (ΟΑΥ pays in arrears), so: service month = document
    date − 1 month.  Prefer the «Payment Date: ...» line (real SRAs also
    list per-invoice dates, which must not win).  A wrong month's SRA is
    not blocked on dates anyway — the tie-outs show the break."""
    for line in text.splitlines():
        if _PAY_DATE_LINE_RE.search(strip_accents(line)):
            y, m = find_period(line)
            if y:
                return prev_month(y, m)
    y, m = find_period(text)
    if y is None:
        return None, None
    return prev_month(y, m)


def find_hospital(text: str) -> Optional[str]:
    """F-code first; else FULL provider name (never «ΛΕΥΚΩΣΙΑΣ» alone —
    it also appears in Makarios exports)."""
    m = F_CODE_RE.search(text)
    if m:
        return m.group(0)
    up = strip_accents(text)
    hits = [code for code, (gr, _en) in HOSPITALS.items() if strip_accents(gr) in up]
    # ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ is not a substring of ΜΑΚΑΡΕΙΟ..., so full-name
    # matches are unambiguous; require exactly one.
    if len(hits) == 1:
        return hits[0]
    return None


# ----------------------------------------------------------------- Excel

def _load_sheets(data: bytes, fmt: str) -> dict[str, pd.DataFrame]:
    engine = "openpyxl" if fmt == "xlsx" else "xlrd"
    return pd.read_excel(io.BytesIO(data), sheet_name=None, header=None,
                         engine=engine, dtype=object)


def _cells_text(df: pd.DataFrame, max_rows: int = 40) -> str:
    parts = []
    for _, row in df.head(max_rows).iterrows():
        for v in row:
            if v is not None and str(v) != "nan":
                parts.append(str(v))
    return " | ".join(parts)


def find_header_row(df: pd.DataFrame, needles: list[str], max_rows: int = 30) -> Optional[int]:
    """First row whose cells contain all needles.  norm_label comparison:
    accents/case/separators (_-./ vs space) are all equivalent, so real-world
    'DR_SEGMENT' matches the 'DR SEGMENT' needle."""
    wanted = [norm_label(n) for n in needles]
    for i in range(min(max_rows, len(df))):
        cells = [norm_label(str(v)) for v in df.iloc[i] if v is not None and str(v) != "nan"]
        joined = " | ".join(cells)
        if all(w in joined for w in wanted):
            return i
    return None


def _column_values(df: pd.DataFrame, header_row: int, header_name: str) -> Optional[pd.Series]:
    hdr = [norm_label(str(v)) if v is not None else "" for v in df.iloc[header_row]]
    want = norm_label(header_name)
    for j, h in enumerate(hdr):
        if want in h:
            return df.iloc[header_row + 1:, j]
    return None


def _excel_probe(sheets: dict[str, pd.DataFrame]) -> str:
    """What the identifier saw: sheet names + the first populated rows.
    Shown in the diagnostics panel so mismatched real-world layouts can be
    spotted (and reported) instantly."""
    parts = []
    for name, df in sheets.items():
        cols = df.shape[1] if len(df) else 0
        parts.append(f"Φύλλο (sheet) «{name}» — {len(df)} γραμμές × {cols} στήλες:")
        shown = 0
        for i in range(min(len(df), 40)):
            cells = [str(v)[:40] for v in list(df.iloc[i])[:12]
                     if v is not None and str(v) != "nan"]
            if not cells:
                continue
            parts.append(f"  γραμμή {i + 1}: " + " | ".join(cells))
            shown += 1
            if shown >= 8:
                break
    return "\n".join(parts)[:4000]


def _labeled_year_month(df: pd.DataFrame, max_rows: int = 10
                        ) -> tuple[Optional[int], Optional[int]]:
    """Real Ενδ. summaries carry «Έτος | Μήνας» header cells with the values
    in the row below (e.g. 2026 | 3).  Find those columns and read them."""
    for i in range(min(max_rows, len(df) - 1)):
        year_col = month_col = None
        for j, v in enumerate(df.iloc[i]):
            if v is None:
                continue
            lab = norm_label(str(v))
            if lab == "ΕΤΟΣ":
                year_col = j
            elif lab == "ΜΗΝΑΣ":
                month_col = j
        if year_col is not None and month_col is not None:
            try:
                y = int(float(str(df.iloc[i + 1, year_col])))
                m = int(float(str(df.iloc[i + 1, month_col])))
            except (TypeError, ValueError):
                continue
            if 2000 <= y <= 2099 and 1 <= m <= 12:
                return y, m
    return None, None


def _identify_excel(f: IdentifiedFile, fmt: str) -> None:
    try:
        sheets = _load_sheets(f.data, fmt)
    except Exception as e:
        f.error = f"Δεν διαβάζεται ως Excel (unreadable as Excel): {e}"
        return
    f.probe = _excel_probe(sheets)

    all_text = ""
    for name, df in sheets.items():
        all_text += f" | {name} | " + _cells_text(df)

    up = strip_accents(all_text)

    for sheet_name, df in sheets.items():
        # Ενδ. summary: «Κωδικός ΓεΣΥ Παροχέα» + «ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ»
        if (find_header_row(df, ["ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ"], max_rows=60) is not None
                and "ΚΩΔΙΚΟΣ ΓΕΣΥ ΠΑΡΟΧΕΑ" in norm_label(_cells_text(df, 60))):
            f.report_type = ReportType.INPATIENT_SUMMARY
            # hospital / year / month sit in the top rows (row 2 in the fixture);
            # real files use «Έτος | Μήνας» header cells with values below
            top = _cells_text(df, 6)
            f.hospital_code = find_hospital(top) or find_hospital(all_text)
            f.year, f.month = _labeled_year_month(df)
            if f.year is None:
                f.year, f.month = find_period(top)
            if f.year is None:
                f.year, f.month = find_period(all_text)
            return

        hr = find_header_row(df, ["DR SEGMENT"])
        if hr is not None:
            f.report_type = ReportType.CLAIMS_ALL
            _fill_from_table(f, df, hr, sheets)
            return

        hr = find_header_row(df, ["TYPE"])
        if hr is not None:
            vals = _column_values(df, hr, "TYPE")
            if vals is not None:
                got = {strip_accents(str(v)) for v in vals.dropna()}
                if got & {"DRUGS", "CONSUMABLES"}:
                    f.report_type = ReportType.PHARMA_CLAIMS
                    _fill_from_table(f, df, hr, sheets)
                    return

        hr = find_header_row(df, ["VENDOR_CODE", "EURO_AMOUNT"])
        if hr is not None:
            f.report_type = ReportType.GL_EXTRACT  # org-wide: no single hospital
            # month from sheet name like 'ALL OKYPY 03.26'
            m = re.search(r"(0?[1-9]|1[0-2])\s*[./]\s*(\d{2})\b", sheet_name)
            if m:
                f.month, f.year = int(m.group(1)), 2000 + int(m.group(2))
            else:
                f.year, f.month = find_period(_cells_text(df, 5))
            return

        hr = find_header_row(df, ["BILLING PROVIDER NAME", "DRG ID"])
        if hr is not None:
            f.report_type = ReportType.IS_AUDITOR  # org-wide
            # its rows carry historical invoice dates spanning years — a
            # period derived from them is meaningless, so don't claim one
            return

    # conditional reports may also arrive as Excel
    if "ΠΟΙΟΤΙΚΑ ΚΡΙΤΗΡΙΑ" in up or "QUALITY CRITERIA" in up:
        f.report_type = ReportType.QUALITY_CRITERIA
    elif "CAPITATION" in up or "ΚΑΤΑ ΚΕΦΑΛΗΝ" in up:
        f.report_type = ReportType.CAPITATION
    elif "ΑΙΜΟΚΑΘΑΡΣ" in up or "HEMODIALYSIS" in up or "HAEMODIALYSIS" in up:
        f.report_type = ReportType.HEMODIALYSIS
    else:
        f.error = ("Άγνωστος τύπος αναφοράς (unrecognised report type) — "
                   "no known header signature found")
        return
    f.hospital_code = find_hospital(all_text)
    f.year, f.month = find_period(all_text)


def _fill_from_table(f: IdentifiedFile, df: pd.DataFrame, header_row: int,
                     sheets: dict[str, pd.DataFrame]) -> None:
    """Hospital + period for row-per-claim tables: from provider columns and
    date-like columns, falling back to any cell in any sheet."""
    body_text = _cells_text(df, header_row + 30)
    f.hospital_code = find_hospital(body_text)
    f.year, f.month = find_period(body_text)
    if f.hospital_code and f.year:
        return
    for _, other in sheets.items():
        t = _cells_text(other, 40)
        if f.hospital_code is None:
            f.hospital_code = find_hospital(t)
        if f.year is None:
            f.year, f.month = find_period(t)
        if f.hospital_code and f.year:
            return


# ------------------------------------------------------------------- PDF

def extract_pdf_text(data: bytes) -> tuple[str, bool]:
    """(text, ocr_used).  pdfplumber first; OCR fallback for scanned pages."""
    import pdfplumber
    text_parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            text_parts.append(page.extract_text() or "")
    text = "\n".join(text_parts).strip()
    if len(text) > 40:  # has a usable text layer
        return text, False
    return _ocr_pdf(data), True


def _ocr_pdf(data: bytes) -> str:
    try:
        import pdfplumber
        import pytesseract
    except ImportError as e:
        raise RuntimeError(
            "Σαρωμένο PDF χωρίς OCR (scanned PDF and OCR unavailable): "
            f"{e}. Install tesseract-ocr and tesseract-ocr-ell."
        ) from e
    parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            img = page.to_image(resolution=300).original
            parts.append(pytesseract.image_to_string(img, lang="ell+eng"))
    return "\n".join(parts)


def identify_pdf_text(text: str) -> Optional[ReportType]:
    """Classify a PDF from its extracted text (unit-testable without a PDF)."""
    up = strip_accents(text)
    # SRA first: its supplier lines mention «Αμοιβή Φαρμακοποιού», capitation
    # etc., so the payment-statement title must win over line keywords
    if "ΚΑΤΑΣΤΑΣΗ ΠΛΗΡΩΜΗΣ" in up or "REMITTANCE" in up:
        return ReportType.SRA
    if "ΑΜΟΙΒΗ ΦΑΡΜΑΚΟΠΟΙΟΥ" in up:
        return ReportType.PHARMACIST_FEE
    if "ΠΟΙΟΤΙΚΑ ΚΡΙΤΗΡΙΑ" in up or "QUALITY CRITERIA" in up:
        return ReportType.QUALITY_CRITERIA
    if "CAPITATION" in up or "ΚΑΤΑ ΚΕΦΑΛΗΝ" in up:
        return ReportType.CAPITATION
    if "ΑΙΜΟΚΑΘΑΡΣ" in up or "HEMODIALYSIS" in up or "HAEMODIALYSIS" in up:
        return ReportType.HEMODIALYSIS
    # SRA fallback: cheque / payment number + a provider F-code
    if (("ΕΠΙΤΑΓΗ" in up or "CHEQUE" in up or "ΑΡ. ΠΛΗΡΩΜΗΣ" in up
         or "PAYMENT" in up) and F_CODE_RE.search(text)):
        return ReportType.SRA
    return None


def _identify_pdf(f: IdentifiedFile) -> None:
    try:
        text, ocr = extract_pdf_text(f.data)
    except Exception as e:
        f.error = f"Αποτυχία ανάγνωσης PDF (PDF read failed): {e}"
        return
    f.ocr_used = ocr
    f.raw_text = text
    f.probe = "Κείμενο PDF (extracted text, first 900 chars):\n" + text[:900]
    if ocr:
        f.warnings.append("Σαρωμένο PDF — χρησιμοποιήθηκε OCR (scanned PDF, OCR used); "
                          "review the extracted lines before running.")
    rt = identify_pdf_text(text)
    if rt is None:
        f.error = "Άγνωστο PDF (unrecognised PDF report)"
        return
    f.report_type = rt
    f.hospital_code = find_hospital(text)
    # SRAs are dated in the payment month (arrears) — dig for the service period
    if rt == ReportType.SRA:
        f.year, f.month = find_service_period(text)
        f.probe = (f.probe or "") + "\n\n" + _sra_probe_summary(text)
    else:
        f.year, f.month = find_period(text)


def _sra_probe_summary(text: str) -> str:
    """Classification summary for the diagnostics panel: every distinct SRA
    line description with count, sum and the bucket it was mapped to — makes
    unmapped/wrongly-mapped descriptions visible at a glance."""
    from .extract import parse_sra_text  # lazy: extract imports identify lazily too
    try:
        sra = parse_sra_text(text)
    except Exception as e:
        return f"SRA γραμμές (line parse): ΑΠΕΤΥΧΕ — {e}"
    groups: dict[tuple[str, str, str], tuple[int, float]] = {}
    for l in sra.lines:
        key = (l.code, l.bucket.value, l.description[:40])
        n, s = groups.get(key, (0, 0.0))
        groups[key] = (n + 1, s + l.amount)
    lines = [f"SRA γραμμές: {len(sra.lines)} · επιταγή #{sra.cheque_no} · "
             f"δηλωμένο σύνολο {sra.stated_total:,.2f} · άθροισμα γραμμών {sra.lines_total:,.2f}",
             "Ταξινόμηση περιγραφών (description → code/bucket, count, sum):"]
    for (code, bucket, desc), (n, s) in sorted(groups.items(), key=lambda kv: -kv[1][1]):
        flag = "  ⚠ UNMAPPED" if code == "??" else ""
        lines.append(f"  «{desc}» → {code} / {bucket} · ×{n} · {s:,.2f}{flag}")
    return "\n".join(lines)[:2500]


# ------------------------------------------------------------------- XML

def _local(tag) -> str:
    return etree.QName(tag).localname if isinstance(tag, str) and tag.startswith("{") else str(tag)


def _identify_xml(f: IdentifiedFile) -> None:
    try:
        root = etree.fromstring(f.data)
    except Exception as e:
        f.error = f"Μη έγκυρο XML (invalid XML): {e}"
        return
    names = {_local(el.tag) for el in root.iter()}
    lowered = {n.lower() for n in names}
    text_all = " ".join(root.itertext())
    f.probe = ("XML root: " + _local(root.tag) + "\nΠεδία (fields): "
               + ", ".join(sorted(names)[:25]))
    if "claimid" in lowered and "activityreimbursementamount" in lowered:
        f.report_type = ReportType.XML_ACTIVITY
    elif {"drsegment", "segment"} & lowered:
        f.report_type = ReportType.CLAIMS_ALL
    else:
        f.error = "Άγνωστο XML (unrecognised XML export — no known field names)"
        return
    f.hospital_code = find_hospital(text_all)
    f.year, f.month = find_period(text_all)


# ------------------------------------------------------------------ main

def identify(filename: str, data: bytes) -> IdentifiedFile:
    f = IdentifiedFile(filename=filename, data=data)
    fmt = sniff_format(data)
    if fmt in ("xlsx", "xls"):
        _identify_excel(f, fmt)
    elif fmt == "pdf":
        _identify_pdf(f)
    elif fmt == "xml":
        _identify_xml(f)
    else:
        f.error = "Μη υποστηριζόμενη μορφή (unsupported file format)"
    return f
