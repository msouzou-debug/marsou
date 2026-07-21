"""PDF text-layer extraction (Stage 2c) — regex field parsing over Greek and
English labels, shared with the OCR path (2d). Also digs Factur-X / ZUGFeRD
embedded XML out of PDFs (2b).

Layouts covered beyond plain invoices: Cyta bills (ΧΡΕΩΣΗ ΜΗΝΑ vs ΟΛΙΚΟ
ΠΛΗΡΩΤΕΟ with prior balance) and EAC bills (ΣΥΝΟΛΟ ΧΡΕΩΣΕΩΝ ΠΕΡΙΟΔΟΥ ΕΚΤΟΣ
ΦΠΑ where part of the net — ΑΠΕ fund, late-payment interest — carries no VAT).
"""

import re
import unicodedata
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


# ---- identifiers: OCR lookalike repair ---------------------------------------

_DIGIT_LOOKALIKES = {"Ο": "0", "ο": "0", "O": "0", "o": "0", "Θ": "0",
                     "Ι": "1", "ι": "1", "I": "1", "l": "1", "|": "1",
                     "S": "5", "s": "5", "B": "8", "Z": "2"}
_LETTER_LOOKALIKES = {"ς": "C", "σ": "C", "Σ": "S", "Ε": "E", "Α": "A", "Β": "B",
                      "Κ": "K", "Μ": "M", "Ν": "N", "Ρ": "P", "Τ": "T", "Χ": "X",
                      "Υ": "Y", "Η": "H", "Ο": "O", "Ζ": "Z", "0": "O", "6": "G"}


def repair_id(token):
    """Repair an OCR-read Cyprus VAT/TIN: 8 digits + check letter, where zeros
    come back as omicrons and the letter as a Greek glyph (9000ο02ος →
    90000020C). Returns the repaired id, or '' if it can't be a valid shape."""
    t = re.sub(r"[\s.]", "", token or "").strip()
    prefix = ""
    if t.upper().startswith("CY"):
        prefix, t = "CY", t[2:]
    if len(t) < 8:
        return ""
    digits = "".join(_DIGIT_LOOKALIKES.get(c, c) for c in t[:8])
    if not digits.isdigit():
        return ""
    rest = t[8:]
    if not rest:
        return prefix + digits             # digit core only — letter unreadable
    letter = _LETTER_LOOKALIKES.get(rest[0], rest[0].upper())
    if letter.isalpha() and letter.isascii() and len(rest) <= 2:
        return prefix + digits + letter
    return prefix + digits


# ---- field parsing over free text (shared with the OCR path) -----------------

_ID_TOKEN = r"((?:CY)?[0-9ΟοOoΘΙιIl|SsBZ]{8}[0-9A-Za-zΑ-Ωα-ως]{0,2})"

_LABELS = {
    "invoice_number": r"(?:INVOICE\s*(?:NO|NUMBER|#)|ΤΙΜΟΛΟΓΙΟ(?:\s*ΑΡ)?|ΑΡ\.?\s*ΤΙΜΟΛΟΓΙΟΥ)[.:\s]*([A-Z0-9][A-Z0-9/\-]*)",
    "invoice_date": r"(?:INVOICE\s*DATE|DATE|ΗΜΕΡΟΜΗΝΙΑ|ΗΜΕΡ\.?\s*ΠΑΡΑΔΟΣΗΣ(?:\s*ΓΙΑ\s*ΦΠΑ)?)[.:\s]*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})",
    "due_date": r"(?:DUE\s*DATE|ΠΡΟΘΕΣΜΙΑ|ΠΛΗΡΩΤΕΟ\s+ΜΕΧΡΙ|ΛΗΞΗ)[.:\s]*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})",
    "vendor_vat": rf"(?:VAT\s*(?:REG(?:ISTRATION)?)?\s*(?:NO|NUMBER|#)?|ΑΡ\.?\s*ΜΗΤΡΩΟΥ\s*ΦΠΑ|Α\.?Φ\.?Μ\.?|ΦΠΑ)[.:\s]*{_ID_TOKEN}",
    "vendor_tin": rf"(?:TAX\s*(?:ID|IDENTIFICATION)\s*(?:NO|NUMBER|CODE)?|T\.?I\.?C\.?|T\.?I\.?N\.?|Α\.?Φ\.?Τ\.?)[.:\s]*{_ID_TOKEN}",
    "po_number": r"(?:P\.?O\.?\s*(?:NO|NUMBER|#)?|ORDER\s*(?:NO|REF)|ΠΑΡΑΓΓΕΛΙΑ)[.:\s]*([A-Z0-9][A-Z0-9\-]{2,})",
}
_IBAN = r"\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b"
_ACCOUNT_NO = r"ΑΡ\.?\s*(?:ΛΟΓΑΡΙΑΣΜΟΥ|ΛΟΓ/ΣΜΟΥ)[.:\s|]*((?:\d[ ]?){8,16})"
# Cyta-style bill reference floating without a label: account-month-year
_BILL_REF = r"\b(\d{6,12}-\d{1,2}-\d{4})\b"
_AMOUNT = r"(\d[\d., ]*[.,]\d{2})"
# OCR renders ΑΠΟ with Latin lookalikes (ANO, AND) — accept them in labels
_APO = r"(?:ΑΠΟ|ANO|AND)"

# Ordered pattern tiers per amount field — the FIRST tier with a match wins,
# so specific bill labels (EAC period totals) beat generic TOTAL/ΣΥΝΟΛΟ.
# Guards: TOTAL must not be the tail of NET TOTAL/SUBTOTAL/ΥΠΟΣΥΝΟΛΟ; the ΦΠΑ
# amount label must not match inside "ΠΡΙΝ (ΑΠΟ) ΤΟ ΦΠΑ" or "ΕΚΤΟΣ ΦΠΑ" or a
# VAT-number line (amounts require decimals, ids have none).
_RATE_TAG = r"(?:\s*[{(\[]?\s*\d{1,2}\s*%\s*[})\]]?)?"
_TOTALS = {
    "net_total": [
        rf"ΣΥΝΟΛ[ΟΑ]\s+ΧΡΕΩΣΕΩΝ\s+ΠΕΡΙΟΔΟΥ\s+ΕΚΤΟΣ\s+Φ\.?Π\.?Α\.?\D{{0,12}}{_AMOUNT}",
        rf"(?:NET(?:\s+TOTAL| AMOUNT)?|SUBTOTAL|ΚΑΘΑΡΗ\s+ΑΞΙΑ|ΥΠΟΣΥΝΟΛΟ|(?:ΣΥΝΟΛ[ΟΑ]\s+|ΟΛΙΚΟ\s+)?ΠΡΙΝ\s+{_APO}?\s*(?:ΤΟ\s+)?Φ\.?Π\.?Α\.?{_RATE_TAG})\D{{0,12}}{_AMOUNT}",
    ],
    "vat_total": [
        rf"(?:VAT(?!\s*REG)|(?<!ΤΟ\s)(?<!ΑΠΟ\s)(?<!ANO\s)(?<!AND\s)(?<!ΕΚΤΟΣ\s)Φ\.?Π\.?Α\.?)(?:{_RATE_TAG})(?:\s+AMOUNT)?\D{{0,12}}{_AMOUNT}",
    ],
    "gross_total": [
        rf"ΣΥΝΟΛΟ\s+ΧΡΕΩΣΕΩΝ\s+ΠΕΡΙΟΔΟΥ(?!\s*ΕΚΤΟΣ)\D{{0,12}}{_AMOUNT}",
        rf"(?:GRAND\s+TOTAL|(?<!NET)(?<!NET\s)(?<!SUB)TOTAL\s*:?\s*(?:DUE|AMOUNT|EUR)?|ΓΕΝΙΚΟ\s+ΣΥΝΟΛΟ|(?<!ΥΠΟ)ΣΥΝΟΛΟ|ΧΡΕΩΣΗ\s+ΜΗΝΑ)\D{{0,12}}{_AMOUNT}",
    ],
}

# The amount actually being asked for — on utility bills this includes any
# unpaid prior balance (Cyta: ΟΛΙΚΟ ΠΛΗΡΩΤΕΟ; EAC: ΠΟΣΟ ΠΛΗΡΩΜΗΣ). Collected
# separately from the tax-invoice gross; repeats resolved by the maximum.
_PAYABLE = (rf"(?:ΟΛΙΚΟ\s+ΠΛΗΡΩΤΕΟ|ΣΥΝΟΛΟ\s+ΠΛΗΡΩΤΕΟ|ΠΛΗΡΩΤΕΟ\s+ΠΟΣΟ|ΠΟΣΟ\s+ΠΛΗΡΩΜΗΣ|"
            rf"TOTAL\s+PAYABLE|(?:TOTAL\s+)?AMOUNT\s+DUE|BALANCE\s+DUE)\D{{0,12}}{_AMOUNT}")

CY_RATES = (19.0, 9.0, 5.0, 3.0)


def _num(raw):
    s = raw.strip().replace(" ", "")
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):   # 1.234,56
            s = s.replace(".", "").replace(",", ".")
        else:                             # 1,234.56
            s = s.replace(",", "")
    elif s.count(",") >= 1:
        head, _, tail = s.rpartition(",")
        if len(tail) == 2:                # 4,582,56 (OCR decimal comma) / 234,56
            s = head.replace(",", "").replace(".", "") + "." + tail
        else:
            s = s.replace(",", "")
    elif s.count(".") > 1:
        head, _, tail = s.rpartition(".")
        if len(tail) == 2:                # 4.582.56
            s = head.replace(".", "") + "." + tail
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


def _name_candidates(text, limit=12):
    """Plausible vendor-name lines from the top of the document, for the
    vendor-master name check (OCR often buries the seller name mid-header)."""
    out = []
    for line in text.splitlines()[:40]:
        line = line.strip()
        words = [w for w in re.findall(r"[A-Za-zΑ-Ωα-ωάέήίόύώϊϋΆΈΉΊΌΎΏ]{3,}", line)]
        if len(words) >= 2 and not re.search(r"\d{5,}", line):
            out.append(line)
        if len(out) >= limit:
            break
    return out


def _split_rates(net, vat_amount):
    """Derive net_by_rate/vat_by_rate. Handles the mixed case where part of
    the net is zero-rated (EAC: ΑΠΕ fund + interest carry no VAT), so
    vat = rate * base with base < net; the remainder goes to 0%."""
    if not net or not vat_amount:
        return {}, {}
    for rate in CY_RATES:
        # single-rate invoice: rate*net reproduces the VAT to rounding accuracy
        if abs(net * rate / 100 - vat_amount) <= max(0.02, 0.001 * net):
            return {rate: round(net, 2)}, {rate: round(vat_amount, 2)}
    for rate in CY_RATES:                # mixed: taxed base + zero-rated rest
        base = round(vat_amount * 100 / rate, 2)
        if base <= net + 0.02:
            zero_part = round(net - base, 2)
            nets = {rate: base}
            vats = {rate: round(vat_amount, 2)}
            if zero_part > 0.02:
                nets[0.0] = zero_part
                vats[0.0] = 0.0
            return nets, vats
    return {}, {}


def parse_fields(text, source, base_confidence):
    """Turn free text into a canonical record. Field confidence starts at
    base_confidence for matched labels; cross-validated fields (amounts that
    add up, parseable dates, repaired ids) are lifted to reflect that."""
    # uppercase AND strip accents: Greek tonos survives .upper() (εκτός ->
    # ΕΚΤΌΣ), which would silently defeat every Greek label and guard
    up = "".join(c for c in unicodedata.normalize("NFD", text.upper())
                 if unicodedata.category(c) != "Mn")
    record = {"source": source, "lines": [], "net_by_rate": {}, "vat_by_rate": {},
              "currency": "EUR", "confidence": {}}

    for field, pattern in _LABELS.items():
        m = re.search(pattern, up)
        value = m.group(1).strip() if m else ""
        conf = base_confidence if value else 0.0
        if field in ("invoice_date", "due_date") and value:
            value = _date_iso(value)
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                conf = max(conf, 0.88)   # parsed into a real date
        if field in ("vendor_vat", "vendor_tin") and value:
            repaired = repair_id(value)
            if repaired:
                value = repaired
                conf = max(conf, 0.9) if len(repaired) == 9 else conf
            else:
                conf = min(conf, 0.5)
        record[field] = value
        record["confidence"][field] = conf

    m = re.search(_IBAN, up.replace(" ", ""))
    record["iban"] = m.group(1) if m else ""
    record["confidence"]["iban"] = base_confidence if m else 0.0

    for field, tiers in _TOTALS.items():
        value, conf = 0.0, 0.0
        for pattern in tiers:
            m = re.search(pattern, up)
            if m:
                value, conf = _num(m.group(1)), base_confidence
                break
        record[field] = value
        record["confidence"][field] = conf

    payable_hits = [_num(v) for v in re.findall(_PAYABLE, up)]
    record["total_payable"] = max(payable_hits) if payable_hits else 0.0
    record["confidence"]["total_payable"] = base_confidence if payable_hits else 0.0

    # utility bills often lack an invoice-number label: try a Cyta-style bill
    # reference (account-month-year token), else account number + bill date —
    # a unique per-month reference that keeps vendor+number dedupe working
    if not record["invoice_number"]:
        m = re.search(_BILL_REF, up)
        if m:
            record["invoice_number"] = m.group(1)
            record["confidence"]["invoice_number"] = max(base_confidence, 0.86)
    if not record["invoice_number"]:
        m = re.search(_ACCOUNT_NO, up)
        if m and record["invoice_date"]:
            record["invoice_number"] = f"{m.group(1).replace(' ', '')}/{record['invoice_date']}"
            record["confidence"]["invoice_number"] = max(base_confidence, 0.86)

    # id-shaped tokens anywhere in the document (8 digits + check letter, CY
    # optional): multi-column bills print the VAT/TIN far from their labels,
    # so the vendor-master match also gets these label-less candidates
    harvested = set()
    for tok in re.findall(r"(?<![A-Z0-9])((?:CY)?[0-9ΟοOoΘΙιIl|]{7,9}[A-ZΑ-Ως])(?![A-Z0-9])", up):
        fixed = repair_id(tok)
        core = fixed[2:] if fixed.startswith("CY") else fixed
        if fixed and len(core) == 9:
            harvested.add(fixed)
    record["id_candidates"] = sorted(harvested)[:20]

    # vendor name: first non-label line, plus candidate lines for the
    # vendor-master name check (2-of-3 matching)
    record["name_candidates"] = _name_candidates(text)
    for line in text.splitlines():
        line = line.strip()
        if line and not re.match(r"(?i)invoice|τιμολ|date|ημερ", line):
            record["vendor_name"] = line
            record["confidence"]["vendor_name"] = base_confidence * 0.9
            break
    else:
        record["vendor_name"] = ""
        record["confidence"]["vendor_name"] = 0.0

    if not record.get("gross_total") and record.get("net_total") and record.get("vat_total"):
        record["gross_total"] = round(record["net_total"] + record["vat_total"], 2)
        record["confidence"]["gross_total"] = min(record["confidence"]["net_total"],
                                                  record["confidence"]["vat_total"])
    # a bill with only a payable amount and no VAT breakdown: payable IS the gross
    if not record.get("gross_total") and record.get("total_payable"):
        record["gross_total"] = record["total_payable"]
        record["confidence"]["gross_total"] = record["confidence"]["total_payable"]

    record["net_by_rate"], record["vat_by_rate"] = _split_rates(
        record.get("net_total", 0.0), record.get("vat_total", 0.0))

    # amounts that add up were read correctly — lift their confidence
    if (record["gross_total"] and record["net_total"] and
            abs(record["net_total"] + record["vat_total"] - record["gross_total"]) <= 0.02):
        for f in ("net_total", "vat_total", "gross_total"):
            record["confidence"][f] = max(record["confidence"][f], 0.92)
    return record


def extract(path):
    text = pdf_to_text(path)
    if len(text.strip()) < 40:  # effectively no text layer -> caller falls through to OCR
        return None
    if text_is_garbled(text):   # custom font encoding -> only OCR can read it
        return None
    return parse_fields(text, "text", base_confidence=0.9)
