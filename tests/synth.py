"""Synthetic ΟΑΥ report files, shaped like the real ones (Greek headers,
Greek number formats) so the identify/extract layers are exercised end to
end without the confidential fixtures.

The default month mirrors the F1049 Mar-2026 acceptance numbers from the
brief: cheque 1,936,528.19 / buckets 1,061,728.70 + 131,284.66 + 78,729.74
+ 664,785.09 / pharmacist fee 8,076 × 1.60 = 12,921.60.
"""
from __future__ import annotations

import io

from lxml import etree
from openpyxl import Workbook


def _wb_bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- Ενδ. summary

def inpatient_summary_xlsx(kanonika=500_000.00, kanonika_parap=61_728.70,
                           exeidikevmena=300_000.00, exeid_parap=100_000.00,
                           z=100_000.00, hospital="F1049",
                           hospital_name="ΓΝ ΑΜΜΟΧΩΣΤΟΥ", period="03/2026",
                           synolo=None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Ενδονοσοκομειακή"
    ws.append(["Ενδονοσοκομειακές Πληρωμένες Απαιτήσεις"])
    ws.append([f"Κωδικός ΓεΣΥ Παροχέα: {hospital}", hospital_name, f"Περίοδος: {period}"])
    ws.append([])
    ws.append(["ΣΥΝΟΠΤΙΚΟΣ ΠΙΝΑΚΑΣ"])
    ws.append(["Κατηγορία", "Αριθμός Απαιτήσεων", "Συνολική αμοιβή"])
    ws.append(["Κανονικά", 120, kanonika])
    ws.append(["Κανονικά με παραπεμπτικό", 15, kanonika_parap])
    ws.append(["Εξειδικευμένα", 60, exeidikevmena])
    ws.append(["Εξειδικευμένα με παραπεμπτικό", 8, exeid_parap])
    ws.append(["Κατάλογος Ζ", 30, z])
    total = synolo if synolo is not None else round(
        kanonika + kanonika_parap + exeidikevmena + exeid_parap + z, 2)
    ws.append(["Σύνολο", 233, total])
    return _wb_bytes(wb)


# --------------------------------------------------------------- claims «all»

DEFAULT_SEGMENTS = {
    "Inpatient": [("Παθολογική (Internal Medicine)", 450_000.00, 300_000.00, 150_000.00),
                  ("Χειρουργική (Surgery)", 400_000.00, 250_000.00, 150_000.00),
                  ("Παιδιατρική (Paediatrics)", 211_728.70, 150_000.00, 61_728.70)],
    "A&E": [("", 131_284.66, 0, 0)],
    "Outpatient Specialists": [("Καρδιολογία (Cardiology)", 25_000.00, 0, 0),
                               ("Ορθοπεδική (Orthopaedics)", 15_000.00, 0, 0)],
    "Nurses-Midwives": [("", 20_000.00, 0, 0)],
    "Allied Health": [("", 5_000.00, 0, 0)],
}


def claims_all_xlsx(segments=None, hospital="F1049", date="15/03/2026") -> bytes:
    """The file ΟΑΥ often names '..._OS_...' — identified by DR SEGMENT content."""
    segments = segments if segments is not None else DEFAULT_SEGMENTS
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(["CLAIM ID", "PROVIDER ID", "DR SEGMENT", "CLINIC", "SPECIALTY",
               "FIXED FEE AMOUNT", "DRG AMOUNT", "HIO REIMB", "PAYMENT DATE"])
    cid = 1000
    for seg, rows in segments.items():
        for clinic, amount, ff, drg in rows:
            ws.append([f"C{cid}", hospital, seg, clinic or None, clinic or None,
                       ff or None, drg or None, amount, date])
            cid += 1
    return _wb_bytes(wb)


# --------------------------------------------------------------- pharma claims

def pharma_claims_xlsx(drugs=600_000.00, consumables=51_863.49,
                       hospital="F1049", date="15/03/2026") -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["INVOICE", "PROVIDER ID", "TYPE", "HIO REIMB", "PAYMENT DATE"])
    ws.append(["PH-1", hospital, "Drugs", round(drugs * 0.6, 2), date])
    ws.append(["PH-2", hospital, "Drugs", round(drugs - round(drugs * 0.6, 2), 2), date])
    ws.append(["PH-3", hospital, "Consumables", consumables, date])
    return _wb_bytes(wb)


# ----------------------------------------------------------------- PDFs (text)

def sra_text(cheque="259434", hospital="F1049",
             hospital_name="ΓΝ ΑΜΜΟΧΩΣΤΟΥ") -> str:
    # The SRA is ALWAYS dated one month after the month it settles (ΟΑΥ pays
    # in arrears): document date 04/2026 -> service month 03/2026.
    return f"""ΟΡΓΑΝΙΣΜΟΣ ΑΣΦΑΛΙΣΗΣ ΥΓΕΙΑΣ
ΚΑΤΑΣΤΑΣΗ ΠΛΗΡΩΜΗΣ (Remittance Advice)
Ημερομηνία Πληρωμής: 15/04/2026
Παροχέας: {hospital} {hospital_name}
Αρ. Επιταγής: {cheque}

IS Ενδονοσοκομειακή Περίθαλψη 1.061.728,70
AE Ατυχήματα και Επείγοντα Περιστατικά 131.284,66
OS Ειδικοί Ιατροί Εξωνοσοκομειακή Φροντίδα 40.000,00
NM Νοσηλευτές και Μαίες 20.000,00
AP Άλλοι Επαγγελματίες Υγείας 5.000,00
PD Προσωπικοί Ιατροί κατά κεφαλήν (capitation) 13.729,74
PHD Φάρμακα 600.000,00
PHC Αναλώσιμα 51.863,49
PHF Αμοιβή Φαρμακοποιού 12.921,60
ΣΥΝΟΛΟ 1.936.528,19
"""


def pharmacist_fee_text(packages=8076, hospital="F1049") -> str:
    amount = f"{packages * 1.60:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    pkg = f"{packages:,}".replace(",", ".")
    return f"""ΟΡΓΑΝΙΣΜΟΣ ΑΣΦΑΛΙΣΗΣ ΥΓΕΙΑΣ
Αμοιβή Φαρμακοποιού
Κωδικός Παροχέα: {hospital}
Μήνας: ΜΑΡΤΙΟΣ Έτος: 2026

Αρ. Τιμολογίου Συσκευασίες Τιμή Μονάδας Ποσό
INV-77812 {pkg} 1,60 {amount}
ΣΥΝΟΛΟ {amount}
"""


def capitation_text(total=13_729.74, hospital="F1049") -> str:
    amt = f"{total:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"""Capitation Report — Κατά κεφαλήν αμοιβή
Παροχέας: {hospital}
Περίοδος: ΜΑΡΤΙΟΣ 2026
Προσωπικοί Ιατροί κατά κεφαλήν {amt}
ΣΥΝΟΛΟ {amt}
"""


# -------------------------------------------------------------------- GL / IS

def gl_xlsx(rows=None, sheet_name="ALL OKYPY 03.26") -> bytes:
    """(vendor, cost_center, account, amount) rows; defaults tie to the synthetic
    month except the pharmacist fee, which reproduces the known flat-booking gap."""
    if rows is None:
        rows = [
            ("F1049", "26001", "40001001", 561_728.70),   # regular DRG
            ("F1049", "26002", "40001002", 400_000.00),   # specialized
            ("F1049", "26003", "40001003", 60_000.00),    # Z-catalogue
            ("F1049", "26007", "40001003", 40_000.00),    # Z-catalogue
            ("F1049", "25801", "40002001", 131_284.66),   # A&E
            ("F1049", "25301", "40003001", 65_000.00),    # outpatient clinical
            ("F1049", "25501", "40004001", 24_000.00),    # pharmacist fee (flat!)
            ("F1049", "25502", "40004002", 651_863.49),   # pharma
            ("F1049", "10101", "51001001", 13_729.74),    # capitation account
            ("F1054", "26001", "40001001", 9_999_999.99), # another hospital, filtered out
        ]
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(["VENDOR_CODE", "COST_CENTER", "ACCOUNT", "EURO_AMOUNT"])
    for r in rows:
        ws.append(list(r))
    return _wb_bytes(wb)


def is_auditor_xlsx(rows=None) -> bytes:
    """(provider, drg_id, drg_ff_amount, procedures_amount, invoice_category)."""
    if rows is None:
        rows = [
            ("ΓΝ ΑΜΜΟΧΩΣΤΟΥ", "DRG001", 500_000.00, 30_000.00, "Κανονικά"),
            ("ΓΝ ΑΜΜΟΧΩΣΤΟΥ", "DRG002", 400_000.00, 51_728.70, "Εξειδικευμένα"),
            ("ΓΝ ΑΜΜΟΧΩΣΤΟΥ", None, None, 50_000.00, "Κανονικά"),      # standalone ZD/ZF/ZC
            ("ΓΝ ΑΜΜΟΧΩΣΤΟΥ", "", None, 30_000.00, "Κανονικά"),        # blank DRG Id
            ("ΓΕΝΙΚΟ ΝΟΣΟΚΟΜΕΙΟ ΛΕΥΚΩΣΙΑΣ", "DRG003", 8_888_888.88, 0, "Κανονικά"),
        ]
    wb = Workbook()
    ws = wb.active
    ws.append(["Billing Provider Name", "DRG Id", "DRG/FF Total Amount",
               "Procedures Total Amount", "Invoice Category", "Admission Date"])
    for r in rows:
        ws.append(list(r) + ["15/03/2026"])
    return _wb_bytes(wb)


# ------------------------------------------------------------------- XML

def xml_activity_bytes(amounts=None, hospital="F1049") -> bytes:
    amounts = amounts if amounts is not None else [40_000.00, 20_000.00, 5_000.00]
    root = etree.Element("Activities")
    etree.SubElement(root, "Provider").text = hospital
    etree.SubElement(root, "Period").text = "03/2026"
    for i, amt in enumerate(amounts, start=1):
        act = etree.SubElement(root, "Activity")
        etree.SubElement(act, "ClaimId").text = f"CL{i:05d}"
        etree.SubElement(act, "ActivityReimbursementAmount").text = f"{amt:.2f}"
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8")
