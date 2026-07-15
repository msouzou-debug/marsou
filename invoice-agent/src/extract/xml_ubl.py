"""UBL 2.1 / Peppol BIS 3.0 extraction (EN 16931 UBL syntax)."""

from lxml import etree

NS = {
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
}


def matches(root):
    return etree.QName(root).localname == "Invoice" and "ubl" in (root.nsmap.get(None) or "")


def _t(node, path):
    if node is None:
        return ""
    hit = node.find(path, NS)
    return (hit.text or "").strip() if hit is not None and hit.text else ""


def _f(node, path):
    v = _t(node, path)
    try:
        return float(v)
    except ValueError:
        return 0.0


def extract(root):
    supplier = root.find("cac:AccountingSupplierParty/cac:Party", NS)
    name = _t(supplier, "cac:PartyLegalEntity/cbc:RegistrationName") or _t(
        supplier, "cac:PartyName/cbc:Name")
    vat = _t(supplier, "cac:PartyTaxScheme/cbc:CompanyID")

    net_by_rate, vat_by_rate = {}, {}
    for sub in root.findall("cac:TaxTotal/cac:TaxSubtotal", NS):
        rate = _f(sub, "cac:TaxCategory/cbc:Percent")
        net_by_rate[rate] = net_by_rate.get(rate, 0.0) + _f(sub, "cbc:TaxableAmount")
        vat_by_rate[rate] = vat_by_rate.get(rate, 0.0) + _f(sub, "cbc:TaxAmount")

    lines = []
    for i, ln in enumerate(root.findall("cac:InvoiceLine", NS), 1):
        qty = _f(ln, "cbc:InvoicedQuantity") or 1.0
        total = _f(ln, "cbc:LineExtensionAmount")
        unit = _f(ln, "cac:Price/cbc:PriceAmount") or (total / qty if qty else 0.0)
        lines.append({
            "line_no": i,
            "description": _t(ln, "cac:Item/cbc:Name") or _t(ln, "cac:Item/cbc:Description"),
            "quantity": qty,
            "unit_price": unit,
            "line_total": total,
            "vat_rate": _f(ln, "cac:Item/cac:ClassifiedTaxCategory/cbc:Percent"),
        })

    monetary = root.find("cac:LegalMonetaryTotal", NS)
    record = {
        "vendor_name": name,
        "vendor_vat": vat,
        "invoice_number": _t(root, "cbc:ID"),
        "invoice_date": _t(root, "cbc:IssueDate"),
        "due_date": _t(root, "cbc:DueDate"),
        "currency": _t(root, "cbc:DocumentCurrencyCode") or "EUR",
        "net_by_rate": net_by_rate,
        "vat_by_rate": vat_by_rate,
        "net_total": _f(monetary, "cbc:TaxExclusiveAmount"),
        "vat_total": sum(vat_by_rate.values()),
        "gross_total": _f(monetary, "cbc:TaxInclusiveAmount") or _f(monetary, "cbc:PayableAmount"),
        "iban": _t(root, "cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID").replace(" ", ""),
        "po_number": _t(root, "cac:OrderReference/cbc:ID"),
        "lines": lines,
        "source": "xml",
    }
    return record
