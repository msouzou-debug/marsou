"""One normalizer per report type -> the same internal schema whatever the
source format (xlsx / xls / xml / pdf) was.

Extraction rules follow the brief exactly (validated on real months):
- Ενδ. summary: Συνολική αμοιβή per category from ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ,
  Σύνολο must equal the sum of its lines.
- Claims «all»: HIO REIMB grouped by DR SEGMENT.
- IS Auditor: DRG flag = notna FIRST, then strip()!='' and lower()!='nan'.
- GL: cost-centre map 26001/26002/26003+26007/25801/25501/255xx/25xxx,
  capitation account 51001001.
Numbers: strip separators, coerce, fillna(0).
"""
from __future__ import annotations

import io
import re
from typing import Optional

import pandas as pd
from lxml import etree

from .models import (Bucket, ClaimsAll, ClinicRow, GLExtract, HOSPITALS,
                     InpatientSummary, ISAuditor, PharmaClaims, PharmacistFee,
                     PHARMACIST_FEE_UNIT_PRICE, ReportType, SimpleReport, SRA,
                     SRALine, XMLActivity, strip_accents)
from .numbers import AMOUNT_RE, find_amounts, parse_amount


class ExtractionError(Exception):
    """Plain-language failure the UI shows verbatim."""


# ------------------------------------------------------------ excel utils

def _load_sheets(data: bytes) -> dict[str, pd.DataFrame]:
    head = data[:8]
    engine = "xlrd" if head.startswith(b"\xd0\xcf\x11\xe0") else "openpyxl"
    return pd.read_excel(io.BytesIO(data), sheet_name=None, header=None,
                         engine=engine, dtype=object)


def _find_header(df: pd.DataFrame, needles: list[str], max_rows: int = 40) -> Optional[int]:
    wanted = [strip_accents(n) for n in needles]
    for i in range(min(max_rows, len(df))):
        joined = " | ".join(strip_accents(str(v)) for v in df.iloc[i]
                            if v is not None and str(v) != "nan")
        if all(w in joined for w in wanted):
            return i
    return None


def _table_at(df: pd.DataFrame, header_row: int) -> pd.DataFrame:
    """DataFrame with real column names from a raw (header=None) sheet."""
    cols = [str(v).strip() if v is not None and str(v) != "nan" else f"_c{j}"
            for j, v in enumerate(df.iloc[header_row])]
    body = df.iloc[header_row + 1:].copy()
    body.columns = cols
    return body.reset_index(drop=True)


def _col(df: pd.DataFrame, *needles: str) -> Optional[str]:
    """First column whose (accent-stripped) name contains any needle."""
    for needle in needles:
        w = strip_accents(needle)
        for c in df.columns:
            if w in strip_accents(str(c)):
                return c
    return None


# ------------------------------------------------- 2. inpatient summary

_SUMMARY_LABELS = [
    # (attr, must-contain, must-NOT-contain) — accent-stripped; specific first
    ("kanonika_parap", ["ΚΑΝΟΝΙΚ", "ΠΑΡΑΠΕΜΠΤΙΚ"], []),
    ("exeid_parap", ["ΕΞΕΙΔΙΚ", "ΠΑΡΑΠΕΜΠΤΙΚ"], []),
    ("kanonika", ["ΚΑΝΟΝΙΚ"], ["ΠΑΡΑΠΕΜΠΤΙΚ"]),
    ("exeidikevmena", ["ΕΞΕΙΔΙΚ"], ["ΠΑΡΑΠΕΜΠΤΙΚ"]),
    ("z_catalogue", ["Z"], ["ΣΥΝΟΛ"]),
    ("synolo", ["ΣΥΝΟΛ"], []),
]


def extract_inpatient_summary(data: bytes) -> InpatientSummary:
    sheets = _load_sheets(data)
    for _, df in sheets.items():
        anchor = _find_header(df, ["ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ"], max_rows=60)
        if anchor is None:
            continue
        # amount column: «Συνολική αμοιβή» header below the anchor, else the
        # last numeric cell per row
        amount_col = None
        for i in range(anchor, min(anchor + 6, len(df))):
            for j, v in enumerate(df.iloc[i]):
                if v is not None and "ΣΥΝΟΛΙΚΗ ΑΜΟΙΒΗ" in strip_accents(str(v)):
                    amount_col = j
                    break
            if amount_col is not None:
                break
        out = InpatientSummary()
        seen = set()
        for i in range(anchor + 1, min(anchor + 25, len(df))):
            row = df.iloc[i]
            label = ""
            for v in row:
                if v is not None and str(v) != "nan" and not _is_number(v):
                    # Greek capital zeta looks like Latin Z — normalize so the
                    # Z-catalogue label matches either alphabet
                    label = strip_accents(str(v)).replace("Ζ", "Z")
                    break
            if not label:
                continue
            for attr, must, must_not in _SUMMARY_LABELS:
                if attr in seen:
                    continue
                if all(m in label for m in must) and not any(m in label for m in must_not):
                    if amount_col is not None and _is_number(row.iloc[amount_col]):
                        val = parse_amount(row.iloc[amount_col])
                    else:
                        nums = [parse_amount(v) for v in row if _is_number(v)]
                        val = nums[-1] if nums else 0.0
                    setattr(out, attr, val)
                    seen.add(attr)
                    break
            if "synolo" in seen:
                break
        if abs(out.synolo - out.computed_total) > 0.005:
            raise ExtractionError(
                "Ενδ. summary: το Σύνολο δεν ισούται με το άθροισμα των γραμμών "
                f"(Σύνολο {out.synolo:,.2f} vs άθροισμα {out.computed_total:,.2f})")
        return out
    raise ExtractionError("Δεν βρέθηκε ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ στο αρχείο Ενδ. summary")


def _is_number(v) -> bool:
    if v is None or isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return v == v
    s = str(v).strip()
    return bool(s) and bool(AMOUNT_RE.fullmatch(s) or re.fullmatch(r"-?\d+([.,]\d+)?", s))


# --------------------------------------------------- 3. claims «all»

SEGMENTS = ["Inpatient", "Outpatient Specialists", "A&E", "Nurses-Midwives", "Allied Health"]

_SEGMENT_ALIASES = {
    "INPATIENT": "Inpatient",
    "OUTPATIENT SPECIALISTS": "Outpatient Specialists",
    "OUTPATIENT SPECIALIST": "Outpatient Specialists",
    "A&E": "A&E",
    "ACCIDENT & EMERGENCY": "A&E",
    "ACCIDENT AND EMERGENCY": "A&E",
    "NURSES-MIDWIVES": "Nurses-Midwives",
    "NURSES MIDWIVES": "Nurses-Midwives",
    "NURSES/MIDWIVES": "Nurses-Midwives",
    "ALLIED HEALTH": "Allied Health",
    "ALLIED HEALTH PROFESSIONALS": "Allied Health",
}


def _canon_segment(raw: str) -> str:
    up = strip_accents(str(raw)).strip()
    return _SEGMENT_ALIASES.get(up, str(raw).strip())


def extract_claims_all(data: bytes) -> ClaimsAll:
    if data.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"<"):
        return _extract_claims_xml(data)
    sheets = _load_sheets(data)
    for _, df in sheets.items():
        hr = _find_header(df, ["DR SEGMENT"])
        if hr is None:
            continue
        t = _table_at(df, hr)
        seg_col = _col(t, "DR SEGMENT")
        amt_col = _col(t, "HIO REIMB")
        if seg_col is None or amt_col is None:
            raise ExtractionError("Claims «all»: λείπει στήλη DR SEGMENT ή HIO REIMB")
        t = t[t[seg_col].notna()]
        out = ClaimsAll()
        amounts = t[amt_col].map(parse_amount)
        for seg, s in amounts.groupby(t[seg_col].map(_canon_segment)):
            out.by_segment[str(seg)] = round(float(s.sum()), 2)
        _per_clinic_detail(t, seg_col, amt_col, amounts, out)
        return out
    raise ExtractionError("Claims «all»: δεν βρέθηκε στήλη DR SEGMENT")


def _per_clinic_detail(t: pd.DataFrame, seg_col: str, amt_col: str,
                       amounts: pd.Series, out: ClaimsAll) -> None:
    """Optional per-clinic / per-specialty detail for the By_Clinic_Split tab."""
    clinic_col = _col(t, "CLINIC", "DEPARTMENT", "ΚΛΙΝΙΚΗ")
    spec_col = _col(t, "SPECIALTY", "SPECIALITY", "ΕΙΔΙΚΟΤΗΤΑ")
    ff_col = _col(t, "FIXED FEE", "FF AMOUNT")
    drg_col = _col(t, "DRG AMOUNT", "DRG REIMB")
    if drg_col == ff_col:
        drg_col = None
    seg = t[seg_col].map(_canon_segment)

    ip = t[seg == "Inpatient"]
    group_col = clinic_col or spec_col
    if group_col is not None and not ip.empty:
        for clinic, g in ip.groupby(ip[group_col].fillna("—").astype(str)):
            total = round(float(g[amt_col].map(parse_amount).sum()), 2)
            ff = round(float(g[ff_col].map(parse_amount).sum()), 2) if ff_col else 0.0
            drg = round(float(g[drg_col].map(parse_amount).sum()), 2) if drg_col else 0.0
            if not ff_col and not drg_col:
                ff = 0.0
                drg = 0.0
            out.inpatient_by_clinic.append(
                ClinicRow(clinic=clinic, fixed_fee=ff, drg=drg, total=total))
        out.inpatient_by_clinic.sort(key=lambda r: -r.total)

    if spec_col is not None:
        os_rows = t[seg == "Outpatient Specialists"]
        if not os_rows.empty:
            for spec, g in os_rows.groupby(os_rows[spec_col].fillna("—").astype(str)):
                out.os_by_specialty[str(spec)] = round(float(g[amt_col].map(parse_amount).sum()), 2)


def _extract_claims_xml(data: bytes) -> ClaimsAll:
    root = etree.fromstring(data)
    out = ClaimsAll()
    sums: dict[str, float] = {}
    for el in root.iter():
        tag = etree.QName(el.tag).localname.lower() if isinstance(el.tag, str) else ""
        if tag in ("claim", "record", "row"):
            seg, amt = None, None
            for child in el.iter():
                ctag = etree.QName(child.tag).localname.lower() if isinstance(child.tag, str) else ""
                if ctag in ("drsegment", "segment"):
                    seg = _canon_segment(child.text or "")
                elif "reimb" in ctag:
                    amt = parse_amount(child.text)
            if seg and amt is not None:
                sums[seg] = sums.get(seg, 0.0) + amt
    if not sums:
        raise ExtractionError("Claims XML: δεν βρέθηκαν εγγραφές με segment/amount")
    out.by_segment = {k: round(v, 2) for k, v in sums.items()}
    return out


# --------------------------------------------------- 4. pharma claims

def extract_pharma_claims(data: bytes) -> PharmaClaims:
    sheets = _load_sheets(data)
    for _, df in sheets.items():
        hr = _find_header(df, ["TYPE"])
        if hr is None:
            continue
        t = _table_at(df, hr)
        type_col = _col(t, "TYPE")
        amt_col = _col(t, "HIO REIMB")
        if type_col is None or amt_col is None:
            continue
        t = t[t[type_col].notna()]
        out = PharmaClaims()
        amounts = t[amt_col].map(parse_amount)
        for typ, s in amounts.groupby(t[type_col].astype(str).str.strip()):
            out.by_type[str(typ)] = round(float(s.sum()), 2)
        if not (set(map(str.upper, out.by_type)) & {"DRUGS", "CONSUMABLES"}):
            continue
        return out
    raise ExtractionError("Pharma claims: δεν βρέθηκε στήλη TYPE με Drugs/Consumables")


# ----------------------------------------------- 5. pharmacist fee (PDF)

def parse_pharmacist_fee_text(text: str) -> PharmacistFee:
    """Parse the Αμοιβή Φαρμακοποιού table: invoice ID, packages, €1.60, amount."""
    unit_re = re.compile(r"\b1[.,]60?\b")
    best: Optional[PharmacistFee] = None
    for line in text.splitlines():
        if not unit_re.search(line):
            continue
        amounts = find_amounts(line)
        ints = [int(i.replace(".", "").replace(",", ""))
                for i in re.findall(r"\b\d{1,3}(?:[.,]\d{3})+\b|\b\d+\b", line)
                if parse_amount(i) == int(parse_amount(i)) and "1,60" not in i]
        invoice = ""
        m = re.search(r"\b(?=\w*\d)([A-Z]{0,4}\d[\w\-/]{3,})\b", line)
        if m and not re.fullmatch(r"[\d.,]+", m.group(1)):
            invoice = m.group(1)
        for pkg in sorted(set(ints), reverse=True):
            expected = round(pkg * PHARMACIST_FEE_UNIT_PRICE, 2)
            for amt in amounts:
                if abs(amt - expected) < 0.005 and pkg > 1:
                    cand = PharmacistFee(packages=pkg, unit_price=PHARMACIST_FEE_UNIT_PRICE,
                                         amount=amt, invoice_id=invoice)
                    if best is None or cand.packages > best.packages:
                        best = cand
    if best:
        return best
    # fallback: stated total on a Σύνολο line + a packages count elsewhere
    total = None
    for line in text.splitlines():
        if "ΣΥΝΟΛ" in strip_accents(line):
            amts = find_amounts(line)
            if amts:
                total = amts[-1]
    if total is not None:
        pkg = round(total / PHARMACIST_FEE_UNIT_PRICE)
        if abs(pkg * PHARMACIST_FEE_UNIT_PRICE - total) < 0.005:
            return PharmacistFee(packages=pkg, unit_price=PHARMACIST_FEE_UNIT_PRICE, amount=total)
    raise ExtractionError(
        "Αμοιβή Φαρμακοποιού: δεν βρέθηκε γραμμή συσκευασίες × 1,60 € = ποσό")


def extract_pharmacist_fee(data: bytes, raw_text: Optional[str] = None) -> PharmacistFee:
    if raw_text is None:
        from .identify import extract_pdf_text
        raw_text, _ = extract_pdf_text(data)
    return parse_pharmacist_fee_text(raw_text)


# --------------------------------------------------------- 1. SRA (PDF)

# SRA code -> (bucket, channel, supporting HIO report).  Keyword fallback
# below handles SRAs whose lines carry no explicit code.  HEMO is an
# adjustment on institutional care; adjust here if a hospital's SRA buckets
# it differently — acceptance fixtures will catch it.
SRA_CODE_MAP: dict[str, tuple[Bucket, str, str]] = {
    "IS": (Bucket.INPATIENT, "Claims", "Ενδ. Πληρωμένες Απαιτήσεις"),
    "AE": (Bucket.AE, "Claims", "Πληρωμένες Απαιτήσεις «all»"),
    "A&E": (Bucket.AE, "Claims", "Πληρωμένες Απαιτήσεις «all»"),
    "OS": (Bucket.OUTPATIENT, "Claims", "Πληρωμένες Απαιτήσεις «all»"),
    "NM": (Bucket.OUTPATIENT, "Claims", "Πληρωμένες Απαιτήσεις «all»"),
    "AP": (Bucket.OUTPATIENT, "Claims", "Πληρωμένες Απαιτήσεις «all»"),
    "PD": (Bucket.OUTPATIENT, "Claims", "Πληρωμένες Απαιτήσεις «all»"),
    "PD-CAP": (Bucket.OUTPATIENT, "Capitation", "Capitation Report"),
    "PD-KPI": (Bucket.OUTPATIENT, "KPI", "Ποιοτικά Κριτήρια"),
    "KPI": (Bucket.OUTPATIENT, "KPI", "Ποιοτικά Κριτήρια"),
    "MRI": (Bucket.OUTPATIENT, "KPI", "Ποιοτικά Κριτήρια"),
    "CT": (Bucket.OUTPATIENT, "KPI", "Ποιοτικά Κριτήρια"),
    "MRI/CT": (Bucket.OUTPATIENT, "KPI", "Ποιοτικά Κριτήρια"),
    "HEMO": (Bucket.INPATIENT, "Adjustment", "Hemodialysis report"),
    "PHD": (Bucket.PHARMA, "Claims", "Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ"),
    "PHC": (Bucket.PHARMA, "Claims", "Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ"),
    "PHF": (Bucket.PHARMA, "Fee", "Pharmacist Fee Report"),
}

_KEYWORD_CODES = [
    # (accent-stripped keyword(s) all required, code) — most specific first
    (["ΑΜΟΙΒΗ ΦΑΡΜΑΚΟΠΟΙΟΥ"], "PHF"),
    (["PHARMACIST FEE"], "PHF"),
    (["ΑΝΑΛΩΣΙΜ"], "PHC"),
    (["CONSUMABLE"], "PHC"),
    (["ΦΑΡΜΑΚ"], "PHD"),
    (["DRUG"], "PHD"),
    (["ΑΙΜΟΚΑΘΑΡΣ"], "HEMO"),
    (["HEMODIALYSIS"], "HEMO"),
    (["ΚΑΤΑ ΚΕΦΑΛΗΝ"], "PD-CAP"),
    (["CAPITATION"], "PD-CAP"),
    (["ΠΟΙΟΤΙΚΑ"], "KPI"),
    (["MRI"], "MRI"),
    (["ΕΝΔΟΝΟΣΟΚΟΜΕΙΑΚ"], "IS"),
    (["INPATIENT"], "IS"),
    (["ΑΤΥΧΗΜΑΤ"], "AE"),
    (["ΕΠΕΙΓΟΝΤ"], "AE"),
    (["EMERGENCY"], "AE"),
    (["ΤΑΕΠ"], "AE"),
    (["ΝΟΣΗΛΕΥΤ"], "NM"),
    (["ΜΑΙΕΣ"], "NM"),
    (["NURSE"], "NM"),
    (["MIDWI"], "NM"),
    (["ΑΛΛΟΙ ΕΠΑΓΓΕΛΜΑΤ"], "AP"),
    (["ALLIED"], "AP"),
    (["ΠΡΟΣΩΠΙΚΟΙ ΙΑΤΡΟΙ"], "PD"),
    (["PERSONAL DOCTOR"], "PD"),
    (["ΕΙΔΙΚΟΙ ΙΑΤΡΟΙ"], "OS"),
    (["ΕΞΩΝΟΣΟΚΟΜΕΙΑΚ"], "OS"),
    (["OUTPATIENT SPECIALIST"], "OS"),
]


def classify_sra_line(code: str, description: str) -> tuple[str, Bucket, str, str]:
    """(canonical code, bucket, channel, source report) for an SRA line."""
    up_desc = strip_accents(description)
    code = (code or "").strip().upper()
    if code in SRA_CODE_MAP:
        # refine PD: capitation vs FFS by description
        if code == "PD" and ("ΚΑΤΑ ΚΕΦΑΛΗΝ" in up_desc or "CAPITATION" in up_desc):
            code = "PD-CAP"
        elif code == "PD" and ("KPI" in up_desc or "ΠΟΙΟΤΙΚ" in up_desc):
            code = "PD-KPI"
        b, ch, src = SRA_CODE_MAP[code]
        return code, b, ch, src
    for keywords, kcode in _KEYWORD_CODES:
        if all(k in up_desc for k in keywords):
            b, ch, src = SRA_CODE_MAP[kcode]
            return kcode, b, ch, src
    # unknown line: park in Outpatient and let the zero-checks surface it
    return code or "??", Bucket.OUTPATIENT, "Unmapped", "—"


_CHEQUE_RE = re.compile(
    r"(?:ΑΡ\.?\s*ΕΠΙΤΑΓΗΣ|ΕΠΙΤΑΓΗ|CHEQUE(?:\s*NO\.?)?|ΑΡ\.?\s*ΠΛΗΡΩΜΗΣ|PAYMENT\s*(?:NO|REF)\.?)"
    r"\s*[:.]?\s*#?(\d{4,})", re.IGNORECASE)

_LINE_RE = re.compile(
    r"^\s*(?P<code>[A-Z][A-Z&/\-]{0,7})?\s*(?P<desc>.*?)\s+(?P<amount>-?(?:\d{1,3}(?:[.,]\d{3})*|\d+)[.,]\d{2})\s*€?\s*$")


def parse_sra_text(text: str) -> SRA:
    """Parse every SRA line: code, description, amount; plus cheque number and
    stated total.  Never guesses an amount — lines without a parseable amount
    are ignored, and the SRA-vs-cheque zero-check catches any loss."""
    from .identify import find_hospital, find_service_period

    cheque = ""
    m = _CHEQUE_RE.search(strip_accents(text))
    if m:
        cheque = m.group(1)

    lines: list[SRALine] = []
    stated_total: Optional[float] = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        up = strip_accents(line)
        m = _LINE_RE.match(line)
        if not m:
            continue
        amount = parse_amount(m.group("amount"))
        desc = (m.group("desc") or "").strip()
        code = (m.group("code") or "").strip()
        if re.search(r"(ΓΕΝΙΚΟ\s+)?ΣΥΝΟΛΟ|(?:GRAND\s+)?TOTAL", up) and "ΥΠΟΣΥΝΟΛ" not in up and "SUBTOTAL" not in up:
            stated_total = amount  # keep the LAST total line (grand total)
            continue
        if "ΥΠΟΣΥΝΟΛ" in up or "SUBTOTAL" in up:
            continue
        canon, bucket, channel, src = classify_sra_line(code, desc or code)
        lines.append(SRALine(code=canon, description=desc or canon, amount=amount,
                             bucket=bucket, channel=channel, source_report=src))
    if not lines:
        raise ExtractionError("SRA: δεν αναγνωρίστηκαν γραμμές πληρωμής στο PDF")
    if stated_total is None:
        raise ExtractionError("SRA: δεν βρέθηκε γραμμή Σύνολο (stated cheque total)")
    sra = SRA(cheque_no=cheque or "UNKNOWN", stated_total=stated_total, lines=lines)
    sra.hospital_code = find_hospital(text)
    sra.year, sra.month = find_service_period(text)
    return sra


def extract_sra(data: bytes, raw_text: Optional[str] = None) -> SRA:
    if raw_text is None:
        from .identify import extract_pdf_text
        raw_text, _ = extract_pdf_text(data)
    return parse_sra_text(raw_text)


# --------------------------------------------------------- GL extract

def extract_gl(data: bytes, hospital_code: str) -> GLExtract:
    sheets = _load_sheets(data)
    for _, df in sheets.items():
        hr = _find_header(df, ["VENDOR_CODE", "EURO_AMOUNT"])
        if hr is None:
            continue
        t = _table_at(df, hr)
        vc = _col(t, "VENDOR_CODE")
        cc = _col(t, "COST_CENTER", "COST_CENTRE")
        acc = _col(t, "ACCOUNT")
        amt = _col(t, "EURO_AMOUNT")
        t = t[t[vc].astype(str).str.strip().str.upper() == hospital_code.upper()]
        out = GLExtract()
        for _, row in t.iterrows():
            amount = parse_amount(row[amt])
            account = str(row[acc]).strip().split(".")[0] if acc else ""
            centre = str(row[cc]).strip().split(".")[0] if cc else ""
            if account == "51001001":
                out.capitation += amount
            elif centre == "26001":
                out.regular_drg += amount
            elif centre == "26002":
                out.specialized += amount
            elif centre in ("26003", "26007"):
                out.z_catalogue += amount
            elif centre == "25801":
                out.ae += amount
            elif centre == "25501":
                out.pharmacist_fee += amount
            elif centre.startswith("255"):
                out.pharma_other += amount
            elif centre.startswith("25"):
                out.outpatient += amount
            else:
                out.other += amount
        for attr in ("regular_drg", "specialized", "z_catalogue", "ae", "pharmacist_fee",
                     "pharma_other", "outpatient", "capitation", "other"):
            setattr(out, attr, round(getattr(out, attr), 2))
        return out
    raise ExtractionError("GL extract: δεν βρέθηκαν στήλες VENDOR_CODE / EURO_AMOUNT")


# --------------------------------------------------------- IS Auditor

def extract_is_auditor(data: bytes, hospital_code: str) -> ISAuditor:
    greek_name = HOSPITALS[hospital_code][0]
    sheets = _load_sheets(data)
    for _, df in sheets.items():
        hr = _find_header(df, ["BILLING PROVIDER NAME", "DRG ID"])
        if hr is None:
            continue
        t = _table_at(df, hr)
        prov = _col(t, "BILLING PROVIDER NAME")
        drg_id = _col(t, "DRG ID")
        drg_ff = _col(t, "DRG/FF TOTAL AMOUNT")
        proc = _col(t, "PROCEDURES TOTAL AMOUNT")
        cat = _col(t, "INVOICE CATEGORY")
        # filter to the hospital by FULL provider name (accent-insensitive)
        want = strip_accents(greek_name)
        t = t[t[prov].map(lambda v: strip_accents(str(v)).strip() == want)]
        # DRG flag: .notna() FIRST, then strip()!='' and lower()!='nan'
        # (pandas StringDtype represents missing as the string 'nan' after astype)
        ids = t[drg_id]
        drg_mask = ids.notna()
        as_str = ids.astype(str).str.strip()
        drg_mask &= (as_str != "") & (as_str.str.lower() != "nan")
        out = ISAuditor()
        if drg_ff:
            out.drg_fees = round(float(t.loc[drg_mask, drg_ff].map(parse_amount).sum()), 2)
        if proc:
            # Z-catalogue = ALL Procedures Total Amount (DRG rows + standalone ZD/ZF/ZC)
            out.z_catalogue = round(float(t[proc].map(parse_amount).sum()), 2)
        if cat:
            cats = t[cat].map(lambda v: strip_accents(str(v)))
            amounts = (t[drg_ff].map(parse_amount) if drg_ff else 0)
            normal_mask = cats.str.contains("ΚΑΝΟΝΙΚ|NORMAL", regex=True, na=False)
            spec_mask = cats.str.contains("ΕΞΕΙΔΙΚ|SPECIAL", regex=True, na=False)
            out.normal = round(float(amounts[normal_mask & drg_mask].sum()), 2)
            out.specialised = round(float(amounts[spec_mask & drg_mask].sum()), 2)
        out.inpatient_total = round(out.drg_fees + out.z_catalogue, 2)
        return out
    raise ExtractionError("IS Auditor: δεν βρέθηκαν στήλες Billing Provider Name / DRG Id")


# --------------------------------------------------------- XML activity

def extract_xml_activity(data: bytes) -> XMLActivity:
    root = etree.fromstring(data)
    total = 0.0
    claims = set()
    found = False
    for el in root.iter():
        tag = etree.QName(el.tag).localname.lower() if isinstance(el.tag, str) else ""
        if tag == "activityreimbursementamount":
            total += parse_amount(el.text)
            found = True
        elif tag == "claimid" and el.text:
            claims.add(el.text.strip())
    if not found:
        raise ExtractionError("XML activity: δεν βρέθηκαν πεδία ActivityReimbursementAmount")
    return XMLActivity(total=round(total, 2), n_claims=len(claims))


# ------------------------------------- capitation / quality / hemo (any fmt)

def extract_simple_report(data: bytes, raw_text: Optional[str] = None) -> SimpleReport:
    """Conditional reports reduce to a total (+ labelled lines when present)."""
    fmt_is_pdf = data[:4] == b"%PDF"
    if fmt_is_pdf or raw_text is not None:
        if raw_text is None:
            from .identify import extract_pdf_text
            raw_text, _ = extract_pdf_text(data)
        return _simple_from_text(raw_text)
    if data.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"<"):
        root = etree.fromstring(data)
        return _simple_from_text("\n".join(root.itertext()))
    sheets = _load_sheets(data)
    lines: list[tuple[str, float]] = []
    total = None
    for _, df in sheets.items():
        for _, row in df.iterrows():
            cells = [v for v in row if v is not None and str(v) != "nan"]
            nums = [parse_amount(v) for v in cells if _is_number(v)]
            labels = [str(v) for v in cells if not _is_number(v)]
            if not nums:
                continue
            label = labels[0] if labels else ""
            if "ΣΥΝΟΛ" in strip_accents(label) or "TOTAL" in strip_accents(label):
                total = nums[-1]
            elif label:
                lines.append((label, nums[-1]))
    if total is None:
        total = round(sum(v for _, v in lines), 2)
    return SimpleReport(total=round(total, 2), lines=lines)


def _simple_from_text(text: str) -> SimpleReport:
    lines: list[tuple[str, float]] = []
    total = None
    for raw in text.splitlines():
        amts = find_amounts(raw)
        if not amts:
            continue
        up = strip_accents(raw)
        if "ΣΥΝΟΛ" in up or "TOTAL" in up:
            total = amts[-1]
        else:
            label = AMOUNT_RE.sub("", raw).strip(" .:€")
            if label:
                lines.append((label, amts[-1]))
    if total is None:
        total = round(sum(v for _, v in lines), 2)
    return SimpleReport(total=round(total, 2), lines=lines)


# ------------------------------------------------------------- dispatcher

def extract(report_type: ReportType, data: bytes, hospital_code: Optional[str] = None,
            raw_text: Optional[str] = None):
    if report_type == ReportType.SRA:
        return extract_sra(data, raw_text)
    if report_type == ReportType.INPATIENT_SUMMARY:
        return extract_inpatient_summary(data)
    if report_type == ReportType.CLAIMS_ALL:
        return extract_claims_all(data)
    if report_type == ReportType.PHARMA_CLAIMS:
        return extract_pharma_claims(data)
    if report_type == ReportType.PHARMACIST_FEE:
        return extract_pharmacist_fee(data, raw_text)
    if report_type == ReportType.GL_EXTRACT:
        return extract_gl(data, hospital_code)
    if report_type == ReportType.IS_AUDITOR:
        return extract_is_auditor(data, hospital_code)
    if report_type == ReportType.XML_ACTIVITY:
        return extract_xml_activity(data)
    return extract_simple_report(data, raw_text)
