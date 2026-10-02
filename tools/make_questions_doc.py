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
    ("Μετά τη μεταστέγαση, κρατά το ΤΑΕΠ Παίδων τον κωδικό 1106;",
     "Μας ενημερώσατε ότι το ΤΑΕΠ Παίδων στεγάζεται προς το παρόν στο Γενικό "
     "Νοσοκομείο Λευκωσίας και θα μεταστεγαστεί στο Νοσοκομείο Αρχιεπίσκοπος "
     "Μακάριος ΙΙΙ. Διορθώσαμε την αντιστοίχιση — την είχαμε συνδέσει λανθασμένα "
     "με το ΝΑΜ ΙΙΙ από την αρχή.\n\n"
     "Η αρίθμηση των κοστολογήσεων είναι συνεχής, χωρίς κενά, και ο αριθμός "
     "αποδίδεται κατά την οριστικοποίηση. Η μεταστέγαση επομένως θέτει ένα "
     "συγκεκριμένο ερώτημα.\n\n"
     "Αν η μονάδα κρατήσει τον 1106 και τη σειρά της, η αλλαγή είναι μία γραμμή "
     "δεδομένων με ημερομηνία ισχύος και τίποτα άλλο. Αν αποκτήσει νέο κωδικό υπό "
     "το ΝΑΜ ΙΙΙ, τότε μία μονάδα θα έχει δύο σειρές αρίθμησης, που είναι "
     "διαφορετικό πράγμα και δεν προστίθεται εκ των υστέρων, αφού θα έχουν ήδη "
     "εκδοθεί αριθμοί.",
     "Μετά τη μεταστέγαση στο ΝΑΜ ΙΙΙ, το ΤΑΕΠ Παίδων διατηρεί τον κωδικό 1106 και "
     "τη συνεχή του αρίθμηση, ή ξεκινά νέα σειρά;", True),
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
    run = paragraph.add_run("Εκκρεμότητα μετά τις αποφάσεις της 02/10/2026")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    meta = document.add_paragraph()
    for label, value in (("Προς: ", "Μονάδα Ελέγχου Εσόδων\n"),
                         ("Από: ", "Τμήμα Πληροφορικής\n"),
                         ("Ημερομηνία: ", "02/10/2026")):
        meta.add_run(label).bold = True
        meta.add_run(value)

    intro = document.add_paragraph()
    intro.add_run(
        "Ευχαριστούμε. Εφαρμόστηκαν και οι δύο απαντήσεις. Απομένει ένα σημείο, που "
        "προκύπτει από την επικείμενη μεταστέγαση του ΤΑΕΠ Παίδων."
    )
    intro.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    applied = document.add_paragraph()
    run = applied.add_run("Τι άλλαξε με βάση τις αποφάσεις σας")
    run.bold, run.font.color.rgb = True, NAVY
    for line in (
        "Το 1054 επιβεβαιώθηκε ως το Γενικό Νοσοκομείο Λευκωσίας. Και οι οκτώ κωδικοί "
        "είναι πλέον καταχωρημένοι.",
        "Διορθώσαμε τη λανθασμένη αντιστοίχιση του 1106: το ΤΑΕΠ Παίδων δεν είναι το "
        "ΝΑΜ ΙΙΙ. Το ΝΑΜ ΙΙΙ δεν λειτουργεί ΤΑΕΠ σήμερα.",
        "Η σημαντικότερη συνέπεια: η μονάδα ΤΑΕΠ δεν ταυτίζεται με το νοσηλευτήριο. "
        "Οκτώ μονάδες σε επτά νοσηλευτήρια, με το Γενικό Λευκωσίας να λειτουργεί δύο "
        "(ενηλίκων 1054, παίδων 1106). Η αρίθμηση είναι ανά μονάδα, ώστε οι δύο "
        "σειρές της Λευκωσίας να μένουν χωριστές· τα δικαιώματα πρόσβασης παραμένουν "
        "ανά νοσηλευτήριο.",
        "Οκτώ μονάδες, όχι εννέα όπως αναφέρει η αρχική περιγραφή του έργου.",
    ):
        bullet = document.add_paragraph(line, style="List Bullet")
        bullet.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        bullet.paragraph_format.space_after = Pt(3)

    document.add_paragraph()
    paragraph = document.add_paragraph()
    run = paragraph.add_run("Εκκρεμότητα")
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

    path = DOCS / "TAEP_ekkremotita_02102026.docx"
    document.save(path)
    print(f"wrote {path.relative_to(ROOT)}  ({len(ITEMS)} open items)")


if __name__ == "__main__":
    main()
