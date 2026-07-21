"""PDF text-layer extraction (Stage 2c) — regex field parsing over Greek and
English labels. Also digs Factur-X / ZUGFeRD embedded XML out of PDFs (2b)."""

import re
import zlib


def embedded_xml(pdf_bytes):
    """Return embedded EN 16931 XML bytes from a Factur-X/ZUGFeRD PDF, or None.
    Scans FlateDecode streams for a CII/UBL root — no full PDF object model
    needed, and works without pypdf."""
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", pdf_bytes, re.DOTALL):
        data = m.group(1)
        for candidate in (data, _inflate(data)):
            if candidate and (b"CrossIndustryInvoice" in candidate[:4096] or
                              b"urn:oasis:names:specification:ubl" in candidate[:4096]):
                start = candidate.find(b"<?xml")
                if start == -1:
                    start = candidate.find(b"<")
                return candidate[start:] if start >= 0 else None
    return None


def _inflate(data):
    try:
        return zlib.decompress(data)
    except zlib.error:
        return None


def pdf_to_text(path):
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


# ---- field parsing over free text (shared with the OCR path) -----------------

MONTHS = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}

_LABELS = {
    "invoice_number": r"(?:INVOICE\s*(?:NO|NUMBER|#)|ΤΙΜΟΛΟΓΙΟ(?:\s*ΑΡ)?|ΑΡ\.?\s*ΤΙΜΟΛΟΓΙΟΥ)[.:\s]*([A-Z0-9][A-Z0-9/\-]*)",
    "invoice_date": r"(?:INVOICE\s*DATE|DATE|ΗΜΕΡΟΜΗΝΙΑ)[.:\s]*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})",
    "due_date": r"(?:DUE\s*DATE|ΠΡΟΘΕΣΜΙΑ|ΛΗΞΗ)[.:\s]*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})",
    "vendor_vat": r"(?:VAT\s*(?:REG(?:ISTRATION)?)?\s*(?:NO|NUMBER|#)?|Α\.?Φ\.?Μ\.?|ΦΠΑ)[.:\s]*((?:CY)?\d{8}[A-Z])",
    "vendor_tin": r"(?:TAX\s*(?:ID|IDENTIFICATION)\s*(?:NO|NUMBER|CODE)?|T\.?I\.?C\.?|T\.?I\.?N\.?|Α\.?Φ\.?Τ\.?)[.:\s]*((?:CY)?\d{8}[A-Z])",
    "po_number": r"(?:P\.?O\.?\s*(?:NO|NUMBER|#)?|ORDER\s*(?:NO|REF)|ΠΑΡΑΓΓΕΛΙΑ)[.:\s]*([A-Z0-9][A-Z0-9\-]{2,})",
}
_IBAN = r"\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b"
_AMOUNT = r"(\d[\d., ]*[.,]\d{2})"  # totals must carry decimals — keeps IDs out
# gross: TOTAL must not be the tail of NET TOTAL / SUBTOTAL / ΥΠΟΣΥΝΟΛΟ —
# fixed-width lookbehinds guard each case (this mis-picked the net as gross).
# VAT: must not match the ΦΠΑ inside "ΠΡΙΝ ΑΠΟ ΤΟ ΦΠΑ" (net-before-VAT label).
_TOTALS = {
    "gross_total": rf"(?:GRAND\s+TOTAL|(?<!NET)(?<!NET\s)(?<!SUB)TOTAL\s*:?\s*(?:DUE|AMOUNT|EUR)?|ΓΕΝΙΚΟ\s+ΣΥΝΟΛΟ|(?<!ΥΠΟ)ΣΥΝΟΛΟ|ΧΡΕΩΣΗ\s+ΜΗΝΑ)\D{{0,12}}{_AMOUNT}",
    "net_total": rf"(?:NET(?:\s+TOTAL| AMOUNT)?|SUBTOTAL|ΚΑΘΑΡΗ\s+ΑΞΙΑ|ΥΠΟΣΥΝΟΛΟ|(?:ΟΛΙΚΟ\s+)?ΠΡΙΝ\s+ΑΠΟ\s+(?:ΤΟ\s+)?Φ\.?Π\.?Α\.?)\D{{0,12}}{_AMOUNT}",
    "vat_total": rf"(?:VAT(?!\s*REG)(?:\s*\d+\s*%)?(?:\s+AMOUNT)?|(?<!ΤΟ\s)(?<!ΑΠΟ\s)Φ\.?Π\.?Α\.?(?:\s*\d+\s*%)?)\D{{0,12}}{_AMOUNT}",
}

# The amount actually being asked for — on utility bills this includes any
# unpaid prior balance (Cyta: ΟΛΙΚΟ ΠΛΗΡΩΤΕΟ). Collected separately from the
# tax-invoice gross; per-section repeats are resolved by taking the maximum.
_PAYABLE = (rf"(?:ΟΛΙΚΟ\s+ΠΛΗΡΩΤΕΟ|ΣΥΝΟΛΟ\s+ΠΛΗΡΩΤΕΟ|ΠΛΗΡΩΤΕΟ\s+ΠΟΣΟ|TOTAL\s+PAYABLE|"
            rf"(?:TOTAL\s+)?AMOUNT\s+DUE|BALANCE\s+DUE)\D{{0,12}}{_AMOUNT}")


def _num(raw):
    s = raw.strip().replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):   # 1.234,56
            s = s.replace(".", "").replace(",", ".")
        else:                             # 1,234.56
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(".", "").replace(",", ".") if len(s.split(",")[-1]) == 2 else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _date_iso(raw):
    raw = raw.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    m = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", raw)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return raw


def parse_fields(text, source, base_confidence):
    """Turn free text into a canonical record. Field confidence =
    base_confidence when the label matched, 0 when not found."""
    up = text.upper()
    record = {"source": source, "lines": [], "net_by_rate": {}, "vat_by_rate": {},
              "currency": "EUR", "confidence": {}}

    for field, pattern in _LABELS.items():
        m = re.search(pattern, up)
        value = m.group(1).strip() if m else ""
        if field in ("invoice_date", "due_date") and value:
            value = _date_iso(value)
        record[field] = value
        record["confidence"][field] = base_confidence if value else 0.0

    m = re.search(_IBAN, up.replace(" ", ""))
    record["iban"] = m.group(1) if m else ""
    record["confidence"]["iban"] = base_confidence if m else 0.0

    for field, pattern in _TOTALS.items():
        m = re.search(pattern, up)
        record[field] = _num(m.group(1)) if m else 0.0
        record["confidence"][field] = base_confidence if m else 0.0

    payable_hits = [_num(v) for v in re.findall(_PAYABLE, up)]
    record["total_payable"] = max(payable_hits) if payable_hits else 0.0
    record["confidence"]["total_payable"] = base_confidence if payable_hits else 0.0

    # vendor name: first non-empty line that isn't a label line
    for line in text.splitlines():
        line = line.strip()
        if line and not re.match(r"(?i)invoice|τιμολ|date|ημερ", line):
            record["vendor_name"] = line
            record["confidence"]["vendor_name"] = base_confidence * 0.9
            break
    else:
        record["vendor_name"] = ""
        record["confidence"]["vendor_name"] = 0.0

    # VAT rate: derive from amounts if consistent with the Cyprus set
    if record["net_total"] and record["vat_total"]:
        rate = round(100 * record["vat_total"] / record["net_total"])
        record["net_by_rate"] = {float(rate): record["net_total"]}
        record["vat_by_rate"] = {float(rate): record["vat_total"]}
    if not record.get("gross_total") and record.get("net_total") and record.get("vat_total"):
        record["gross_total"] = round(record["net_total"] + record["vat_total"], 2)
    # a bill with only a payable amount and no VAT breakdown: payable IS the gross
    if not record.get("gross_total") and record.get("total_payable"):
        record["gross_total"] = record["total_payable"]
        record["confidence"]["gross_total"] = record["confidence"]["total_payable"]
    return record


def text_is_garbled(text):
    """Custom-encoded fonts (e.g. Cyta bills) produce an unusable text layer:
    pdfminer emits (cid:NN) placeholders and symbol soup. Detect it so the
    caller falls through to OCR instead of extracting nothing (or nonsense)."""
    if text.count("(cid:") >= 5:
        return True
    letters = sum(1 for c in text if c.isalpha())
    readable = sum(1 for c in text if ("A" <= c <= "Z" or "a" <= c <= "z"
                                       or "Ͱ" <= c <= "Ͽ" or "ἀ" <= c <= "῿"))
    return letters > 40 and readable / letters < 0.6


def extract(path):
    text = pdf_to_text(path)
    if len(text.strip()) < 40:  # effectively no text layer -> caller falls through to OCR
        return None
    if text_is_garbled(text):   # custom font encoding -> only OCR can read it
        return None
    return parse_fields(text, "text", base_confidence=0.9)
