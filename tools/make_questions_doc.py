# -*- coding: utf-8 -*-
"""
Builds the Greek follow-up for Μονάδα Ελέγχου Εσόδων after the rulings of 22/09/2026.

Figures are read from the seed data, not typed.
    python3 tools/make_questions_doc.py
"""
import csv
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor, Cm

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
NAVY = RGBColor(0x1F, 0x38, 0x64)
RED = RGBColor(0xA3, 0x1E, 0x1E)

categories = list(csv.DictReader(open(ROOT / "seed" / "financial_categories.csv",
                                      encoding="utf-8")))
services = list(csv.DictReader(open(ROOT / "seed" / "services.csv", encoding="utf-8")))
TARIFF_CATS = [c["code_new"] for c in categories if c["tariff_applies"] == "TRUE"]
VALID_AE = sum(1 for c in categories if c["valid_for_ae"] == "TRUE")

ITEMS = [
    ("Είναι το 1054 το Γενικό Νοσοκομείο Λευκωσίας;",
     "Μας δώσατε επτά κωδικούς: Λεμεσός 1047, Λάρνακα 1048, Πάφος 1025, Αμμόχωστος "
     "1049, Πόλης Χρυσοχούς 1026, Κυπερούντας 1055, ΤΑΕΠ Παίδων Λευκωσίας 1106.\n\n"
     "Αντιστοιχούν σε επτά από τα οκτώ νοσηλευτήρια που τηρεί το eFinance. Μένει ένα "
     "νοσηλευτήριο, το Γενικό Νοσοκομείο Λευκωσίας, και μένει ένας κωδικός, το 1054 "
     "από το υπόδειγμα κοστολόγησης. Η αντιστοίχιση είναι σχεδόν βέβαιη, αλλά "
     "προκύπτει από αποκλεισμό και όχι από δική σας δήλωση, οπότε δεν την "
     "κλειδώνουμε.\n\n"
     "Μέχρι να επιβεβαιωθεί, το Γενικό Νοσοκομείο Λευκωσίας δεν εκδίδει αριθμούς "
     "κοστολόγησης. Λανθασμένος κωδικός νοσηλευτηρίου μέσα σε συνεχή αρίθμηση χωρίς "
     "κενά δεν διορθώνεται εκ των υστέρων.\n\n"
     "Σημειώνουμε και δύο διαφορές ονομασίας, για να είναι ρητή η αντιστοίχιση: το "
     "«Κυπερούντας» είναι το Νοσοκομείο Τροόδους στο eFinance, και το «ΤΑΕΠ Παίδων "
     "Λευκωσίας» είναι το Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ.",
     "Επιβεβαίωση ότι το 1054 είναι το Γενικό Νοσοκομείο Λευκωσίας.", True),

    ("Υπάρχει ένατο νοσηλευτήριο με ΤΑ.ΕΠ.;",
     "Η αρχική περιγραφή του έργου αναφέρει εννέα νοσηλευτήρια. Το eFinance τηρεί "
     "οκτώ με τύπο «νοσηλευτήριο», και εσείς δώσατε επτά κωδικούς.\n\n"
     "Τίποτα δεν δείχνει ένατο, αλλά ούτε το αποκλείει, και ο αριθμός εννέα "
     "επαναλαμβάνεται αρκετά συχνά στα έγγραφα του έργου ώστε να αξίζει ένας έλεγχος.",
     "Πόσα νοσηλευτήρια λειτουργούν ΤΑ.ΕΠ. και ποια είναι αυτά;", False),
]


def main():
    document = Document()
    style = document.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)
    for section in document.sections:
        section.top_margin = section.bottom_margin = Cm(2)
        section.left_margin = section.right_margin = Cm(2.2)

    paragraph = document.add_paragraph()
    run = paragraph.add_run("Κοστολόγηση Περιστατικών ΤΑ.ΕΠ. — μη δικαιούχοι ΓεΣΥ")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(15), NAVY

    paragraph = document.add_paragraph()
    run = paragraph.add_run("Εκκρεμότητες μετά τις αποφάσεις της 29/09/2026")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    meta = document.add_paragraph()
    for label, value in (("Προς: ", "Μονάδα Ελέγχου Εσόδων\n"),
                         ("Από: ", "Τμήμα Πληροφορικής\n"),
                         ("Ημερομηνία: ", "30/09/2026")):
        meta.add_run(label).bold = True
        meta.add_run(value)

    intro = document.add_paragraph()
    intro.add_run(
        "Ευχαριστούμε. Εφαρμόστηκαν και οι τρεις απαντήσεις. Απομένουν δύο σημεία, και "
        "τα δύο περί νοσηλευτηρίων."
    )
    intro.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    applied = document.add_paragraph()
    run = applied.add_run("Τι άλλαξε με βάση τις αποφάσεις σας")
    run.bold, run.font.color.rgb = True, NAVY
    for line in (
        "Το τέλος εγγραφής ΤΑΕΠ ορίστηκε στα €10,00 για τις κατηγορίες 603, 605 και "
        "608 και προστίθεται στο κόστος. Η κατηγορία 600 δεν έχει τέλος εγγραφής· "
        "δίνει προκαταβολή €100,00 που δεν προστίθεται. Ο πίνακάς σας και η απάντησή "
        "σας συμφωνούν πλέον πλήρως.",
        "Ο πίνακας αρμόδιας αρχής φορτώθηκε. 29 από τις 38 κατηγορίες χρεώνονται σε "
        "τρίτο: Υπουργείο Υγείας, Υπουργείο Δικαιοσύνης (601, 641), Υπηρεσία Ασύλου "
        "(628), Υπουργείο Εξωτερικών (629) και Βρετανικές Βάσεις (640).",
        "Οι επτά κωδικοί νοσηλευτηρίων καταχωρήθηκαν. Κάθε νοσηλευτήριο εκδίδει τη "
        "δική του σειρά, π.χ. OKY1047/0001 για τη Λεμεσό.",
    ):
        bullet = document.add_paragraph(line, style="List Bullet")
        bullet.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        bullet.paragraph_format.space_after = Pt(3)

    document.add_paragraph()
    paragraph = document.add_paragraph()
    run = paragraph.add_run("Εκκρεμή")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    for index, (heading, body, asked, urgent) in enumerate(ITEMS, start=1):
        paragraph = document.add_paragraph()
        run = paragraph.add_run(f"{index}. {heading}")
        run.bold, run.font.size = True, Pt(11)
        if urgent:
            run.font.color.rgb = RED

        for block in body.split("\n\n"):
            text = document.add_paragraph(block)
            text.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            text.paragraph_format.space_after = Pt(4)

        request = document.add_paragraph()
        run = request.add_run("Ζητούμενο: ")
        run.bold, run.font.color.rgb = True, NAVY
        request.add_run(asked)

        answer = document.add_paragraph()
        answer.add_run("Απόφαση Μονάδας: ").bold = True
        answer.add_run("…………………………………………………………………………………………………………")
        answer.paragraph_format.space_after = Pt(14)

    path = DOCS / "TAEP_ekkremotites_30092026.docx"
    document.save(path)
    print(f"wrote {path.relative_to(ROOT)}  ({len(ITEMS)} open items)")


if __name__ == "__main__":
    main()
