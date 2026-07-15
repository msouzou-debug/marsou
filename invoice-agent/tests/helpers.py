"""Builders for synthetic invoice files (UBL, CII, text-layer PDF, Factur-X).

The committed golden set is generated with these until the real anonymized
50+ invoice set (§8) is collected with the operator — the pipeline tests also
use them to fabricate invoices with today's dates.
"""

UBL_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>{number}</cbc:ID>
  <cbc:IssueDate>{date}</cbc:IssueDate>
  <cbc:DueDate>{due}</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:OrderReference><cbc:ID>{po}</cbc:ID></cac:OrderReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>{vendor}</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>{vat_no}</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>{vendor}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>{iban}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">{vat_amt}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">{net}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">{vat_amt}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:Percent>{rate}</cbc:Percent></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">{net}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">{gross}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">{gross}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
{lines}</Invoice>
"""

UBL_LINE = """  <cac:InvoiceLine>
    <cbc:InvoicedQuantity>{qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">{total}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>{desc}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:Percent>{rate}</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">{price}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
"""

CII_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
 xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
 xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
 xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>{number}</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102">{date_102}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
{lines}    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>{vendor}</ram:Name>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">{vat_no}</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>{po}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>{iban}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>{vat_amt}</ram:CalculatedAmount>
        <ram:BasisAmount>{net}</ram:BasisAmount>
        <ram:RateApplicablePercent>{rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>{net}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">{vat_amt}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>{gross}</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
"""

CII_LINE = """    <ram:IncludedSupplyChainTradeLineItem>
      <ram:SpecifiedTradeProduct><ram:Name>{desc}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>{price}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity>{qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:RateApplicablePercent>{rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>{total}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
"""


def _fmt_lines(template, lines, rate):
    return "".join(template.format(desc=d, qty=q, price=p, total=round(q * p, 2), rate=rate)
                   for d, q, p in lines)


def make_ubl(vendor, vat_no, number, date, net, rate, iban, lines, po="", due=""):
    vat_amt = round(net * rate / 100, 2)
    return UBL_TEMPLATE.format(
        number=number, date=date, due=due or date, po=po, vendor=vendor, vat_no=vat_no,
        iban=iban, net=f"{net:.2f}", vat_amt=f"{vat_amt:.2f}",
        gross=f"{net + vat_amt:.2f}", rate=rate,
        lines=_fmt_lines(UBL_LINE, lines, rate)).encode("utf-8")


def make_cii(vendor, vat_no, number, date, net, rate, iban, lines, po=""):
    vat_amt = round(net * rate / 100, 2)
    return CII_TEMPLATE.format(
        number=number, date_102=date.replace("-", ""), po=po, vendor=vendor,
        vat_no=vat_no, iban=iban, net=f"{net:.2f}", vat_amt=f"{vat_amt:.2f}",
        gross=f"{net + vat_amt:.2f}", rate=rate,
        lines=_fmt_lines(CII_LINE, lines, rate)).encode("utf-8")


def make_pdf(text_lines):
    """Minimal single-page PDF with a real text layer (Helvetica, latin-1)."""
    body = ["BT /F1 11 Tf 50 780 Td 16 TL"]
    for line in text_lines:
        safe = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        body.append(f"({safe}) Tj T*")
    body.append("ET")
    stream = "\n".join(body).encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n").encode()
    return bytes(out)


def make_text_pdf(vendor, vat_no, number, date, net, rate, iban, po=""):
    vat_amt = round(net * rate / 100, 2)
    lines = [
        vendor,
        "OKYpY - State Health Services Organisation",
        f"Invoice No: {number}",
        f"Invoice Date: {date}",
        f"VAT Reg No: {vat_no}",
        f"PO Number: {po}" if po else "",
        f"IBAN: {iban}",
        "",
        f"Net Total: {net:.2f}",
        f"VAT {rate}%: {vat_amt:.2f}",
        f"Grand Total: {net + vat_amt:.2f} EUR",
    ]
    return make_pdf([l for l in lines if l != ""])


def make_facturx(vendor, vat_no, number, date, net, rate, iban, lines, po=""):
    """PDF with a text layer AND an embedded CII XML stream (Factur-X-style)."""
    pdf = make_text_pdf(vendor, vat_no, number, date, net, rate, iban, po)
    xml = make_cii(vendor, vat_no, number, date, net, rate, iban, lines, po)
    embedded = (b"9 0 obj\n<< /Type /EmbeddedFile /Length " + str(len(xml)).encode() +
                b" >>\nstream\n" + xml + b"\nendstream\nendobj\n")
    eof = pdf.rfind(b"startxref")
    return pdf[:eof] + embedded + pdf[eof:]
