"""Stage 3: VAT number format/checksum and VAT-rate membership."""

import re
from datetime import date, datetime

# Cyprus TIC checksum (pre-2024 8-digit+letter format still on all documents)
_CY_WEIGHT_ODD = {0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21}


def cy_vat_valid(vat):
    v = re.sub(r"[^A-Z0-9]", "", vat.upper())
    v = v[2:] if v.startswith("CY") else v
    if not re.fullmatch(r"\d{8}[A-Z]", v):
        return False
    digits = [int(c) for c in v[:8]]
    total = sum(_CY_WEIGHT_ODD[d] for d in digits[0::2]) + sum(digits[1::2])
    return chr(ord("A") + total % 26) == v[8]


_EU_FORMATS = {
    "EL": r"\d{9}", "DE": r"\d{9}", "FR": r"[A-Z0-9]{2}\d{9}", "IT": r"\d{11}",
    "ES": r"[A-Z0-9]\d{7}[A-Z0-9]", "NL": r"\d{9}B\d{2}", "BE": r"[01]\d{9}",
    "AT": r"U\d{8}", "IE": r"\d{7}[A-Z]{1,2}|\d[A-Z+*]\d{5}[A-Z]", "PT": r"\d{9}",
    "PL": r"\d{10}", "RO": r"\d{2,10}", "BG": r"\d{9,10}", "HR": r"\d{11}",
    "SI": r"\d{8}", "SK": r"\d{10}", "CZ": r"\d{8,10}", "HU": r"\d{8}",
    "DK": r"\d{8}", "SE": r"\d{12}", "FI": r"\d{8}", "EE": r"\d{9}",
    "LV": r"\d{11}", "LT": r"(\d{9}|\d{12})", "LU": r"\d{8}", "MT": r"\d{8}",
    "GR": r"\d{9}",
}


def vat_number_valid(vat):
    """Full checksum for CY; format check for other EU prefixes; a bare
    8-digit+letter value is treated as Cypriot."""
    v = re.sub(r"[^A-Z0-9]", "", (vat or "").upper())
    if not v:
        return False
    if v.startswith("CY") or re.fullmatch(r"\d{8}[A-Z]", v):
        return cy_vat_valid(v)
    prefix, rest = v[:2], v[2:]
    if prefix in _EU_FORMATS:
        return re.fullmatch(_EU_FORMATS[prefix], rest) is not None
    return False


def check(record, settings, known_vat_cores=()):
    failures = []
    # A VAT that exactly matches the vendor master is accepted as-is (it is what
    # SAP has); the strict format/checksum test guards VATs we can't match —
    # typically OCR misreads.
    vat_core = re.sub(r"[^A-Z0-9]", "", (record["vendor_vat"] or "").upper())
    vat_core = vat_core[2:] if vat_core.startswith("CY") else vat_core
    if vat_core not in known_vat_cores and not vat_number_valid(record["vendor_vat"]):
        failures.append(f"VAT number fails format/checksum: '{record['vendor_vat']}'")

    allowed = {float(r) for r in settings["validation"]["vat_rates"]}
    for rate in set(record.get("net_by_rate", {})) | set(record.get("vat_by_rate", {})) | {
            ln.get("vat_rate", 0.0) for ln in record.get("lines", [])}:
        if float(rate) not in allowed:
            failures.append(f"VAT rate {rate}% not in the Cyprus set {sorted(allowed)}")

    if record.get("currency") and record["currency"] not in settings["validation"].get("currencies", ["EUR"]):
        failures.append(f"currency {record['currency']} not accepted")

    inv_date = _parse_date(record.get("invoice_date"))
    if inv_date is None:
        failures.append(f"invoice date unreadable: '{record.get('invoice_date')}'")
    else:
        today = date.today()
        if inv_date > today:
            failures.append(f"invoice date {inv_date} is in the future")
        else:
            months = settings["validation"]["max_invoice_age_months"]
            age = (today.year - inv_date.year) * 12 + today.month - inv_date.month
            if age > months:
                failures.append(f"invoice date {inv_date} older than {months} months")
    return failures


def _parse_date(raw):
    try:
        return datetime.strptime((raw or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
