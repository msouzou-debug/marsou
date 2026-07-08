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
                     SRALine, XMLActivity, norm_label, strip_accents)
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
    wanted = [norm_label(n) for n in needles]
    for i in range(min(max_rows, len(df))):
        joined = " | ".join(norm_label(str(v)) for v in df.iloc[i]
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
    """First column whose name contains any needle (norm_label comparison:
    accents/case/separators are equivalent — 'HIO_REIMB' matches 'HIO REIMB')."""
    for needle in needles:
        w = norm_label(needle)
        for c in df.columns:
            if w in norm_label(str(c)):
                return c
    return None


# ------------------------------------------------- 2. inpatient summary

def _classify_category(label: str) -> Optional[str]:
    """label is accent-stripped + Greek Ζ->Z.  None = unknown category (kept
    in .other so the Σύνολο assert still holds when ΟΑΥ adds new lines)."""
    if "ΣΥΝΟΛ" in label:
        return "synolo"
    parap = "ΠΑΡΑΠΕΜΠΤΙΚ" in label
    if "ΚΑΝΟΝΙΚ" in label:
        return "kanonika_parap" if parap else "kanonika"
    if "ΕΞΕΙΔΙΚ" in label:
        return "exeid_parap" if parap else "exeidikevmena"
    if "ΓΕΝΝ" in label:                       # Γέννες (births)
        return "gennes"
    if "ΚΑΤΑΛΟΓ" in label or re.search(r"(?:^|[\s\-])Z(?:$|[\s\-])", label):
        return "z_catalogue"
    return None


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
        for i in range(anchor + 1, min(anchor + 30, len(df))):
            row = df.iloc[i]
            label = ""
            raw_label = ""
            for v in row:
                if v is not None and str(v) != "nan" and not _is_number(v):
                    raw_label = str(v).strip()
                    # Greek capital zeta looks like Latin Z — accept either
                    label = strip_accents(raw_label).replace("Ζ", "Z")
                    break
            if not label:
                continue
            if amount_col is not None and _is_number(row.iloc[amount_col]):
                val = parse_amount(row.iloc[amount_col])
            else:
                nums = [parse_amount(v) for v in row if _is_number(v)]
                if not nums:
                    continue  # header row of the block, no amounts
                val = nums[-1]
            cls = _classify_category(label)
            if cls == "synolo":
                out.synolo = val
                break
            if cls:
                setattr(out, cls, round(getattr(out, cls) + val, 2))
            else:
                out.other[raw_label] = round(out.other.get(raw_label, 0.0) + val, 2)
        if abs(out.synolo - out.computed_total) > 0.005:
            raise ExtractionError(
                "Ενδ. summary: το Σύνολο δεν ισούται με το άθροισμα των γραμμών "
                f"(Σύνολο {out.synolo:,.2f} vs άθροισμα {out.computed_total:,.2f})")
        out.by_clinic = _per_clinic_detail_sheet(sheets)
        return out
    raise ExtractionError("Δεν βρέθηκε ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ στο αρχείο Ενδ. summary")


def _per_clinic_detail_sheet(sheets: dict[str, pd.DataFrame]) -> list[ClinicRow]:
    """Real Ενδ. workbooks carry a «per clinic» pivot: Row Labels | Sum of
    FIXED FEE | Sum of INPATIENTS | Sum of Grand Total — the per-clinic
    detail the By_Clinic_Split tab needs."""
    for _, df in sheets.items():
        hr = _find_header(df, ["ROW LABELS", "FIXED FEE", "GRAND TOTAL"])
        if hr is None:
            continue
        hdr = [norm_label(str(v)) if v is not None else "" for v in df.iloc[hr]]

        def first(needle: str) -> Optional[int]:
            for j, h in enumerate(hdr):
                if needle in h:
                    return j
            return None

        lab = first("ROW LABELS")
        ff, ip, gt = first("FIXED FEE"), first("INPATIENTS"), first("GRAND TOTAL")
        rows: list[ClinicRow] = []
        for i in range(hr + 1, len(df)):
            v = df.iloc[i, lab]
            if v is None or str(v) == "nan":
                continue
            clinic = str(v).strip()
            nl = norm_label(clinic)
            if "GRAND TOTAL" in nl or "ΣΥΝΟΛ" in nl:
                continue
            ffv = parse_amount(df.iloc[i, ff]) if ff is not None else 0.0
            ipv = parse_amount(df.iloc[i, ip]) if ip is not None else 0.0
            gtv = parse_amount(df.iloc[i, gt]) if gt is not None else 0.0
            total = gtv if gtv else round(ffv + ipv, 2)
            if total == 0 and ffv == 0 and ipv == 0:
                continue
            rows.append(ClinicRow(clinic=clinic, fixed_fee=round(ffv, 2),
                                  drg=round(ipv, 2), total=round(total, 2)))
        rows.sort(key=lambda r: -r.total)
        return rows
    return []


def _is_number(v) -> bool:
    if v is None or isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return v == v
    s = str(v).replace("€", "").strip()   # cells like '€ 0.00'
    return bool(s) and bool(AMOUNT_RE.fullmatch(s) or re.fullmatch(r"-?\d+([.,]\d+)?", s))


# --------------------------------------------------- 3. claims «all»

SEGMENTS = ["Inpatient", "Outpatient Specialists", "A&E", "Nurses-Midwives", "Allied Health"]

_SEGMENT_ALIASES = {
    "INPATIENT": "Inpatient",
    "IS": "Inpatient",
    "IP": "Inpatient",
    "INPATIENT SERVICES": "Inpatient",
    "OUTPATIENT SPECIALISTS": "Outpatient Specialists",
    "OUTPATIENT SPECIALIST": "Outpatient Specialists",
    "OS": "Outpatient Specialists",
    "A&E": "A&E",
    "AE": "A&E",
    "ACCIDENT & EMERGENCY": "A&E",
    "ACCIDENT AND EMERGENCY": "A&E",
    "NURSES-MIDWIVES": "Nurses-Midwives",
    "NURSES MIDWIVES": "Nurses-Midwives",
    "NURSES/MIDWIVES": "Nurses-Midwives",
    "NM": "Nurses-Midwives",
    "ALLIED HEALTH": "Allied Health",
    "ALLIED HEALTH PROFESSIONALS": "Allied Health",
    "AP": "Allied Health",
    "AHP": "Allied Health",
}


def _canon_segment(raw: str) -> str:
    up = norm_label(str(raw))
    if up in _SEGMENT_ALIASES:
        return _SEGMENT_ALIASES[up]
    # keyword fallback for longer / Greek variants
    if "INPATIENT" in up or "ΕΝΔΟΝΟΣΟΚ" in up:
        return "Inpatient"
    if "SPECIALIST" in up or "ΕΙΔΙΚΟΙ" in up:
        return "Outpatient Specialists"
    if "EMERGENCY" in up or "ΕΠΕΙΓ" in up or "ΑΤΥΧΗΜ" in up or "ΤΑΕΠ" in up:
        return "A&E"
    if "NURSE" in up or "MIDWI" in up or "ΝΟΣΗΛΕΥΤ" in up or "ΜΑΙ" == up:
        return "Nurses-Midwives"
    if "ALLIED" in up or "ΑΛΛΟΙ ΕΠΑΓΓΕΛΜ" in up:
        return "Allied Health"
    return str(raw).strip()


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
        segs = t[seg_col].map(_canon_segment)
        for seg, s in amounts.groupby(segs):
            out.by_segment[str(seg)] = round(float(s.sum()), 2)
        # keep inpatient row detail for old-claim candidate explanations
        id_col = _col(t, "CLAIM ID")
        date_col = _col(t, "INVOICE DATE")
        if id_col is not None:
            ip_mask = segs == "Inpatient"
            for idx in t.index[ip_mask]:
                out.inpatient_rows.append((
                    str(t.at[idx, id_col]),
                    str(t.at[idx, date_col]) if date_col is not None else "",
                    round(parse_amount(t.at[idx, amt_col]), 2)))
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
    """Parse the Αμοιβή Φαρμακοποιού table: invoice ID, unit price, packages,
    amount.  The unit price is READ from the document (1.60 € historically,
    1.62 € in newer months — it changes): find the (unit, packages, amount)
    triple on a line where packages × unit = amount."""
    best: Optional[PharmacistFee] = None
    for line in text.splitlines():
        amounts = find_amounts(line)
        if len(amounts) < 2:
            continue
        ints = [int(parse_amount(i))
                for i in re.findall(r"\b\d{1,3}(?:[.,]\d{3})+\b|\b\d+\b", line)
                if parse_amount(i) == int(parse_amount(i))]
        invoice = ""
        m = re.search(r"\b(?=\w*\d)([A-Z]{0,4}\d[\w\-/]{3,})\b", line)
        if m and not re.fullmatch(r"[\d.,]+", m.group(1)):
            invoice = m.group(1)
        for pkg in sorted(set(ints), reverse=True):
            if pkg <= 1:
                continue
            for unit in amounts:
                if not 0.05 <= unit <= 20:      # plausible per-package fee
                    continue
                expected = round(pkg * unit, 2)
                for amt in amounts:
                    if amt is unit:
                        continue
                    if abs(amt - expected) < 0.005:
                        cand = PharmacistFee(packages=pkg, unit_price=unit,
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
    # real SRAs pay pharmacy claims as daily «PH - HCP SERVICES» invoices
    "PH": (Bucket.PHARMA, "Claims", "Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ"),
    # pharmacy credit notes / deductions / manual adjustments — kept apart
    # from the daily PH lines so «claims gross = PH − fee» ties exactly
    "PH-ADJ": (Bucket.PHARMA, "Adjustment", "Πληρωμένες Απαιτήσεις ΦΑΡΜΑΚΑ"),
    # A&E-referral and similar A&E adjustments, apart from the daily AE lines
    "AE-ADJ": (Bucket.AE, "Adjustment", "Πληρωμένες Απαιτήσεις «all»"),
}

# adjustment markers that split a stream's ADJ/CRN lines from its daily lines
_ADJ_MARKER_RE = re.compile(
    r"ADJ|CRN|CREDIT|CORR|DEDUCTION|ISSUANCE|STOCK|MANUAL|OTC")

_KEYWORD_CODES = [
    # (accent-stripped keyword(s) all required, code) — most specific first
    (["ΑΜΟΙΒΗ ΦΑΡΜΑΚΟΠΟΙΟΥ"], "PHF"),
    (["PHARMACIST FEE"], "PHF"),
    (["ΑΝΑΛΩΣΙΜ"], "PHC"),
    (["CONSUMABLE"], "PHC"),
    (["ΦΑΡΜΑΚ"], "PHD"),
    (["DRUG"], "PHD"),
    (["ΣΥΝΤΑΓ"], "PHD"),      # χειρόγραφες συνταγές (handwritten prescriptions)
    (["ISSUANCE"], "PHD"),    # EOAF issuances deductions
    (["EOAF"], "PHD"),
    (["PHARMACY"], "PH"),     # PharmacyLine adjustments
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


# Invoice descriptions on real SRAs start with the stream code, e.g.
# «AE - HCP SERVICES».  Longer alternatives first; IP is an alias of IS.
_CODE_TOKEN_RE = re.compile(r"\b(A&E|PHD|PHC|PHF|PH|HEMO|MRI|CT|IP|IS|AE|OS|NM|AP|PD)\b")
_CODE_ALIASES = {"IP": "IS"}


def classify_sra_line(code: str, description: str) -> tuple[str, Bucket, str, str]:
    """(canonical code, bucket, channel, source report) for an SRA line."""
    up_desc = strip_accents(description)
    code = (code or "").strip().upper()
    if code not in SRA_CODE_MAP:
        # semantic pre-pass BEFORE the code-token scan: these descriptions
        # carry a misleading stream token («CRN-Packages PH - ...» is a fee
        # correction, «ADJ- IS - Adjustment for Hemodialysis» is the hemo
        # adjustment whose bucket depends on the patient)
        if "PACKAG" in up_desc:
            code = "PHF"        # pharmacist-fee package corrections (CRN)
        elif "HEMODIALY" in up_desc or "ΑΙΜΟΚΑΘΑΡΣ" in up_desc:
            code = "HEMO"
    if code not in SRA_CODE_MAP:
        # real SRA lines are invoice-level: the stream code sits inside the
        # description («AE - HCP SERVICES») — take the first code token
        m = _CODE_TOKEN_RE.search(up_desc)
        if m:
            code = _CODE_ALIASES.get(m.group(1), m.group(1))
    if code not in SRA_CODE_MAP:
        for keywords, kcode in _KEYWORD_CODES:
            if all(k in up_desc for k in keywords):
                code = kcode
                break
    if code in SRA_CODE_MAP:
        # refine PD: capitation vs FFS by description
        if code == "PD" and ("ΚΑΤΑ ΚΕΦΑΛΗΝ" in up_desc or "CAPITATION" in up_desc):
            code = "PD-CAP"
        elif code == "PD" and ("KPI" in up_desc or "ΠΟΙΟΤΙΚ" in up_desc):
            code = "PD-KPI"
        # credit notes / corrections split away from the daily claim lines,
        # so «SRA PH = claims gross + fee» and «SRA AE = GL 25801» tie exactly
        elif code in ("PH", "PHD", "PHC") and _ADJ_MARKER_RE.search(up_desc):
            code = "PH-ADJ"
        elif code in ("AE", "A&E") and _ADJ_MARKER_RE.search(up_desc):
            code = "AE-ADJ"
        b, ch, src = SRA_CODE_MAP[code]
        return code, b, ch, src
    # unknown line: park in Outpatient and let the zero-checks surface it
    return code or "??", Bucket.OUTPATIENT, "Unmapped", "—"


_CHEQUE_RE = re.compile(
    r"(?:ΑΡ\.?\s*ΕΠΙΤΑΓΗΣ|ΕΠΙΤΑΓΗ|CHEQUE(?:\s*NO\.?)?|ΑΡ\.?\s*ΠΛΗΡΩΜΗΣ|PAYMENT\s*(?:NO|REF)\.?)"
    r"\s*[:.]?\s*#?(\d{4,})", re.IGNORECASE)

_AMT = r"-?(?:\d{1,3}(?:[.,]\d{3})*|\d+)[.,]\d{2}-?"   # trailing '-' = credit

_LINE_RE = re.compile(
    rf"^\s*(?P<code>[A-Z][A-Z&/\-]{{0,7}})?\s*(?P<desc>.*?)\s+(?P<amount>{_AMT})\s*€?\s*$")

# real SRA line: Invoice Date | Invoice No | Description | Invoice Total |
# Currency | Amount Paid — e.g.
# «01/03/2026 5636247 AE - HCP SERVICES 22,101.00 EUR 22,101.00»
_INVOICE_LINE_RE = re.compile(
    rf"^\s*(?P<date>\d{{1,2}}/\d{{1,2}}/\d{{4}})\s+(?P<inv>\d{{4,}})\s+(?P<desc>.+?)\s+"
    rf"(?P<total>{_AMT})\s+(?P<cur>[A-Z]{{3}})\s+(?P<paid>{_AMT})\s*$")


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
        # invoice-level line (the real SRA format) takes priority
        inv = _INVOICE_LINE_RE.match(line)
        if inv:
            desc = inv.group("desc").strip()
            amount = parse_amount(inv.group("paid"))  # Amount Paid column
            canon, bucket, channel, src = classify_sra_line("", desc)
            lines.append(SRALine(code=canon,
                                 description=f"{desc} ({inv.group('date')} #{inv.group('inv')})",
                                 amount=amount, bucket=bucket, channel=channel,
                                 source_report=src))
            continue
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
        # wrapped-row fragments: a continuation line like «se 12.25» carries
        # a spilled amount from the row above — counting it double-counts
        letters = re.sub(r"[^A-Za-zΑ-Ωα-ωΆ-Ώά-ώ]", "", (code or "") + desc)
        if len(letters) < 3:
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


def merge_sras(sras: list[SRA]) -> SRA:
    """A month can be settled by several cheques: merge multiple SRAs into
    one logical SRA.  Lines are concatenated (tagged with their cheque so the
    workbook keeps the audit trail), totals summed, and .parts keeps the
    per-cheque tie-out for gate 4."""
    if len(sras) == 1:
        s = sras[0]
        s.parts = [(s.cheque_no, s.lines_total, s.stated_total)]
        return s
    lines: list[SRALine] = []
    parts: list[tuple[str, float, float]] = []
    for s in sras:
        for l in s.lines:
            lines.append(SRALine(code=l.code,
                                 description=f"{l.description} [επ. {s.cheque_no}]",
                                 amount=l.amount, bucket=l.bucket, channel=l.channel,
                                 source_report=l.source_report))
        parts.append((s.cheque_no, s.lines_total, s.stated_total))
    cheques = [s.cheque_no for s in sras]
    label = "+".join(cheques) if len(cheques) <= 2 else \
        "+".join(cheques[:2]) + f"+{len(cheques) - 2}"
    merged = SRA(cheque_no=label,
                 stated_total=round(sum(s.stated_total for s in sras), 2),
                 lines=lines, parts=parts)
    merged.hospital_code = next((s.hospital_code for s in sras if s.hospital_code), None)
    dated = next(((s.year, s.month) for s in sras if s.year), (None, None))
    merged.year, merged.month = dated
    return merged


# --------------------------------------------------------- GL extract

def extract_gl(data: bytes, hospital_code: str) -> GLExtract:
    sheets = _load_sheets(data)
    candidates = []
    for name, df in sheets.items():
        hr = _find_header(df, ["VENDOR_CODE", "EURO_AMOUNT"])
        if hr is not None:
            candidates.append((name, df, hr))
    # prefer the org-wide «ALL OKYPY MM.YY» sheet: real workbooks put
    # per-stream detail sheets (A&E clinic pivot, per-hospital copies)
    # FIRST, and reading one of those instead zeroes every other bucket
    candidates.sort(key=lambda c: 0 if "ALL OKYPY" in norm_label(c[0]) else 1)
    for _, df, hr in candidates[:1]:
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
        # filter to the hospital by full provider name — real names are long
        # forms («ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΑΜΜΟΧΩΣΤΟΥ (ΟΚΥπΥ)»), so match by
        # distinctive tokens; Nicosia explicitly excludes Makarios
        from .models import hospital_name_matches
        t = t[t[prov].map(lambda v: v is not None
                          and hospital_name_matches(hospital_code, str(v)))]
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
    by_payment: dict[str, float] = {}
    found = False

    def _local(el) -> str:
        return etree.QName(el.tag).localname.lower() if isinstance(el.tag, str) else ""

    # group per <Claim>: each carries ClaimPaymentNumber (the SRA cheque that
    # paid it) — the join key for the payment-number gate
    for claim in root.iter():
        if _local(claim) != "claim":
            continue
        pay = ""
        amt = 0.0
        has_amount = False
        for el in claim.iter():
            tag = _local(el)
            if tag == "activityreimbursementamount":
                amt += parse_amount(el.text)
                has_amount = True
            elif tag == "claimid" and el.text:
                claims.add(el.text.strip())
            elif tag == "claimpaymentnumber" and el.text:
                pay = el.text.strip()
        total += amt
        if has_amount:
            found = True
            by_payment[pay] = round(by_payment.get(pay, 0.0) + amt, 2)
    if not found:
        # flat exports without a <Claim> wrapper: sum what's there
        for el in root.iter():
            tag = _local(el)
            if tag == "activityreimbursementamount":
                total += parse_amount(el.text)
                found = True
            elif tag == "claimid" and el.text:
                claims.add(el.text.strip())
    if not found:
        raise ExtractionError("XML activity: δεν βρέθηκαν πεδία ActivityReimbursementAmount")
    return XMLActivity(total=round(total, 2), n_claims=len(claims),
                       by_payment=by_payment)


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
    # invoice-level rows first (real capitation reports: «5729128 F1049 ...
    # STANDARD 31/03/2026 5,174.80 €» followed by per-doctor and per-age
    # detail that must NOT be double-counted)
    invoice_rows: list[tuple[str, float]] = []
    for raw in text.splitlines():
        up = strip_accents(raw)
        if re.search(r"\b\d{6,}\b", raw) and "STANDARD" in up:
            amts = find_amounts(raw)
            if amts:
                invoice_rows.append((raw.strip()[:60], amts[-1]))
    if invoice_rows:
        return SimpleReport(total=round(sum(v for _, v in invoice_rows), 2),
                            lines=invoice_rows)
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
