"""Stage 2 dispatcher + canonical record.

Order (§5): (a) structured XML (UBL / CII / Peppol); (b) PDF with embedded XML
(Factur-X / ZUGFeRD); (c) PDF text layer; (d) OCR; optional LLM fallback (§9).
Every field carries a source and a confidence; any critical field below the
threshold routes the invoice to human review, never onward.
"""

from lxml import etree

from . import pdf_ocr, pdf_text, xml_cii, xml_ubl

CRITICAL_FIELDS = ("vendor_vat", "invoice_number", "invoice_date", "gross_total")

FIELD_DEFAULTS = {
    "vendor_name": "", "vendor_vat": "", "vendor_tin": "", "invoice_number": "", "invoice_date": "",
    "due_date": "", "currency": "EUR", "net_by_rate": {}, "vat_by_rate": {},
    "net_total": 0.0, "vat_total": 0.0, "gross_total": 0.0, "total_payable": 0.0,
    "iban": "", "po_number": "", "lines": [],
}


class ExtractionFailed(Exception):
    pass


def _finalize(record):
    for k, v in FIELD_DEFAULTS.items():
        record.setdefault(k, v)
    if "confidence" not in record:
        # structured XML: what's present is authoritative, what's absent is absent
        record["confidence"] = {
            f: (0.99 if record.get(f) else 0.0)
            for f in ("vendor_name", "vendor_vat", "invoice_number", "invoice_date",
                      "gross_total", "iban")
        }
    if not record.get("net_total") and record.get("net_by_rate"):
        record["net_total"] = round(sum(record["net_by_rate"].values()), 2)
    if not record.get("vat_total") and record.get("vat_by_rate"):
        record["vat_total"] = round(sum(record["vat_by_rate"].values()), 2)
    record["vendor_vat"] = (record.get("vendor_vat") or "").replace(" ", "").upper()
    record["vendor_tin"] = (record.get("vendor_tin") or "").replace(" ", "").upper()
    record["iban"] = (record.get("iban") or "").replace(" ", "").upper()
    return record


def _try_xml(data):
    try:
        root = etree.fromstring(data)
    except etree.XMLSyntaxError:
        return None
    for mod in (xml_ubl, xml_cii):
        if mod.matches(root):
            return _finalize(mod.extract(root))
    return None


def extract_file(path, original_name):
    """Return (record, None) or (None, reason-for-review-queue)."""
    with open(path, "rb") as f:
        data = f.read()
    name = original_name.lower()

    if name.endswith(".p7m"):  # signed envelope: the XML payload is inside
        start = data.find(b"<?xml")
        if start >= 0:
            data = data[start:data.rfind(b">") + 1]
        name = name[:-4]

    if name.endswith(".xml") or data.lstrip()[:5] == b"<?xml" or data.lstrip()[:1] == b"<":
        record = _try_xml(data)
        if record:
            return record, None
        if name.endswith(".xml"):
            return None, "unrecognized XML dialect (not UBL 2.1 / CII / Peppol BIS)"

    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        embedded = pdf_text.embedded_xml(data)
        if embedded:
            record = _try_xml(embedded)
            if record:
                record["source"] = "xml"
                return record, None
        try:
            record = pdf_text.extract(path)
        except Exception as e:  # noqa: BLE001
            return None, f"PDF text extraction failed: {e}"
        if record:
            return record, None
        try:
            return pdf_ocr.extract(path), None
        except pdf_ocr.OcrUnavailable as e:
            return None, str(e)
        except Exception as e:  # noqa: BLE001
            return None, f"OCR failed: {e}"

    return None, f"unsupported file type: {original_name}"


def low_confidence_fields(record, threshold):
    conf = record.get("confidence", {})
    return [f for f in CRITICAL_FIELDS if conf.get(f, 0.0) < threshold]
