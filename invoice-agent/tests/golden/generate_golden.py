"""(Re)generate the synthetic golden set deterministically.

STAND-IN: §8 requires >=50 real anonymized invoices covering the top 20
vendors — collect those with the operator during Phase 2 and replace/extend
this set. Until then this set exercises all extraction paths (UBL, CII, text
PDF, Factur-X embedded XML) with vendors taken from the real vendor master.

Run from the repo root: python tests/golden/generate_golden.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from tests.helpers import make_cii, make_facturx, make_text_pdf, make_ubl  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# real accounts from the clean vendor master (vendor-cleanup contract file)
VENDORS = [
    ("A. KIRMITSIS LTD", "CY10131613M", "CY19002001300000001112585300"),
    ("A.J. VOUROS LTD", "CY10114836F", "CY50002001940000001100015200"),
    ("A.G.F TRADING AND ENGINEERING LTD", "CY10070841B", "CY77002001950000357013692918"),
]

CASES = []
for i, (vendor, vat_no, iban) in enumerate(VENDORS):
    for j, (fmt, rate) in enumerate([("ubl", 19), ("cii", 19), ("pdf", 19),
                                     ("ubl", 9), ("facturx", 5)]):
        number = f"INV-2025-{i + 1}{j + 1:02d}"
        net = round(850.00 + 137.25 * (i * 5 + j), 2)
        CASES.append({
            "file": f"{fmt}_{vendor.split()[0].strip('.').lower()}_{number}",
            "format": fmt, "vendor": vendor, "vat_no": vat_no, "iban": iban,
            "number": number, "date": "2025-11-15", "net": net, "rate": rate,
            "lines": [("MAINTENANCE SERVICES", 2, round(net / 4, 2)),
                      ("CLEANING MATERIALS", 1, round(net - 2 * round(net / 4, 2), 2))],
        })


def generate():
    manifest = []
    for c in CASES:
        vat_amt = round(c["net"] * c["rate"] / 100, 2)
        if c["format"] == "ubl":
            data, ext = make_ubl(c["vendor"], c["vat_no"], c["number"], c["date"],
                                 c["net"], c["rate"], c["iban"], c["lines"]), "xml"
        elif c["format"] == "cii":
            data, ext = make_cii(c["vendor"], c["vat_no"], c["number"], c["date"],
                                 c["net"], c["rate"], c["iban"], c["lines"]), "xml"
        elif c["format"] == "facturx":
            data, ext = make_facturx(c["vendor"], c["vat_no"], c["number"], c["date"],
                                     c["net"], c["rate"], c["iban"], c["lines"]), "pdf"
        else:
            data, ext = make_text_pdf(c["vendor"], c["vat_no"], c["number"], c["date"],
                                      c["net"], c["rate"], c["iban"]), "pdf"
        name = f"{c['file']}.{ext}"
        with open(os.path.join(HERE, name), "wb") as f:
            f.write(data)
        expected = {
            "vendor_vat": c["vat_no"], "invoice_number": c["number"],
            "invoice_date": c["date"], "net_total": c["net"], "vat_total": vat_amt,
            "gross_total": round(c["net"] + vat_amt, 2), "iban": c["iban"],
            "source": "xml" if c["format"] in ("ubl", "cii", "facturx") else "text",
        }
        with open(os.path.join(HERE, f"{name}.expected.json"), "w", encoding="utf-8") as f:
            json.dump(expected, f, indent=2)
        manifest.append(name)
    print(f"golden set: {len(manifest)} files")


if __name__ == "__main__":
    generate()
