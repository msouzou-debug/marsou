"""UN/CEFACT Cross-Industry Invoice (CII) extraction — also the XML inside
Factur-X / ZUGFeRD PDFs."""

from lxml import etree

NS = {
    "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
    "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
    "udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
}


def matches(root):
    return etree.QName(root).localname == "CrossIndustryInvoice"


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


def _date(node, path):
    raw = _t(node, path)
    if len(raw) == 8 and raw.isdigit():  # format="102": YYYYMMDD
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    return raw


def extract(root):
    tx = root.find("rsm:SupplyChainTradeTransaction", NS)
    agreement = tx.find("ram:ApplicableHeaderTradeAgreement", NS) if tx is not None else None
    settlement = tx.find("ram:ApplicableHeaderTradeSettlement", NS) if tx is not None else None
    seller = agreement.find("ram:SellerTradeParty", NS) if agreement is not None else None

    net_by_rate, vat_by_rate = {}, {}
    for tax in (settlement.findall("ram:ApplicableTradeTax", NS) if settlement is not None else []):
        rate = _f(tax, "ram:RateApplicablePercent")
        net_by_rate[rate] = net_by_rate.get(rate, 0.0) + _f(tax, "ram:BasisAmount")
        vat_by_rate[rate] = vat_by_rate.get(rate, 0.0) + _f(tax, "ram:CalculatedAmount")

    lines = []
    for i, ln in enumerate(tx.findall("ram:IncludedSupplyChainTradeLineItem", NS) if tx is not None else [], 1):
        qty = _f(ln, "ram:SpecifiedLineTradeDelivery/ram:BilledQuantity") or 1.0
        total = _f(ln, "ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount")
        unit = _f(ln, "ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount") or (
            total / qty if qty else 0.0)
        lines.append({
            "line_no": i,
            "description": _t(ln, "ram:SpecifiedTradeProduct/ram:Name"),
            "quantity": qty,
            "unit_price": unit,
            "line_total": total,
            "vat_rate": _f(ln, "ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent"),
        })

    summation = settlement.find("ram:SpecifiedTradeSettlementHeaderMonetarySummation", NS) if settlement is not None else None
    # tax registrations: schemeID VA = VAT number, FC = fiscal/tax number (TIN)
    vat = tin = ""
    for reg in (seller.findall("ram:SpecifiedTaxRegistration/ram:ID", NS) if seller is not None else []):
        value = (reg.text or "").strip()
        scheme = reg.get("schemeID", "")
        if scheme == "FC":
            tin = tin or value
        else:
            vat = vat or value

    record = {
        "vendor_name": _t(seller, "ram:Name"),
        "vendor_vat": vat,
        "vendor_tin": tin,
        "invoice_number": _t(root, "rsm:ExchangedDocument/ram:ID"),
        "invoice_date": _date(root, "rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString"),
        "due_date": _date(settlement, "ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString"),
        "currency": _t(settlement, "ram:InvoiceCurrencyCode") or "EUR",
        "net_by_rate": net_by_rate,
        "vat_by_rate": vat_by_rate,
        "net_total": _f(summation, "ram:TaxBasisTotalAmount"),
        "vat_total": _f(summation, "ram:TaxTotalAmount") or sum(vat_by_rate.values()),
        "gross_total": _f(summation, "ram:GrandTotalAmount"),
        "iban": _t(settlement, "ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:IBANID").replace(" ", ""),
        "po_number": _t(agreement, "ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID"),
        "lines": lines,
        "source": "xml",
    }
    return record
