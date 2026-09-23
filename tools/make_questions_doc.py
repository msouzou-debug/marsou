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
    ("Τα τέλη εγγραφής του πίνακά σας διαφωνούν με τη γραπτή σας επιβεβαίωση",
     "Ο πίνακας που στείλατε στις 23/09 δίνει τέλος εγγραφής ΤΑΕΠ €10,00 για τις "
     "κατηγορίες 603, 605 και 608. Την ίδια ημέρα επιβεβαιώσατε γραπτώς ότι οι "
     "κατηγορίες αυτές μηδενίζονται.\n\n"
     "Εφαρμόσαμε τη γραπτή απάντηση, δηλαδή €0,00, επειδή απαντούσε ακριβώς σε αυτό "
     "το ερώτημα. Κρατήσαμε δίπλα και την τιμή του πίνακα, ώστε η διαφωνία να "
     "φαίνεται και να διορθώνεται με μία γραμμή.\n\n"
     "Το ποσό είναι μικρό. Η διαφωνία όμως είναι ανάμεσα σε δύο δηλώσεις της ίδιας "
     "ημέρας, και μια σιωπηλή επιλογή γίνεται μόνιμο λάθος.",
     "Ποιο ισχύει για τις 603, 605 και 608 στα ΤΑ.ΕΠ.: €10,00 ή €0,00;", True),

    ("Ο πίνακας με την αρμόδια αρχή δεν έχει ακόμη παραληφθεί",
     "Στο προηγούμενο σημείωμα ζητήσαμε τον πίνακα με την αρμόδια αρχή ανά οικονομική "
     "κατηγορία και απαντήσατε «το στέλνω τώρα».\n\n"
     "Το αρχείο που λάβαμε είναι ο πίνακας τελών εγγραφής. Οι στήλες του είναι ΤΑΕΠ, "
     "Εξωνοσοκομειακή, Ενδονοσοκομειακή, Φάρμακα, Εργαστηριακά και μία κενή στήλη "
     "Σχόλια. Στήλη με την αρμόδια αρχή δεν υπάρχει.\n\n"
     "Δεν εμποδίζει την πρώτη φάση, που απλώς τυπώνει τον υπόχρεο. Εμποδίζει τη "
     "δεύτερη, που τον τιμολογεί.",
     "Αποστολή του πίνακα με την αρμόδια αρχή ανά οικονομική κατηγορία.", False),

    ("Οι κωδικοί των εννέα νοσηλευτηρίων",
     "Η σύνθεση του αριθμού κοστολόγησης κλείδωσε και αναπαράγει το υπόδειγμα: "
     "OKY1054/0035, δηλαδή κωδικός νοσηλευτηρίου και αύξων αριθμός ανά νοσηλευτήριο.\n\n"
     "Το 1054 είναι ο μόνος κωδικός που έχουμε δει. Χωρίς τους υπόλοιπους οκτώ, μόνο "
     "ένα νοσηλευτήριο μπορεί να εκδώσει αριθμό.",
     "Ο κωδικός καθενός από τα εννέα νοσηλευτήρια.", False),
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
    run = paragraph.add_run("Εκκρεμότητες μετά τις αποφάσεις της 23/09/2026")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    meta = document.add_paragraph()
    for label, value in (("Προς: ", "Μονάδα Ελέγχου Εσόδων\n"),
                         ("Από: ", "Τμήμα Πληροφορικής\n"),
                         ("Ημερομηνία: ", "23/09/2026")):
        meta.add_run(label).bold = True
        meta.add_run(value)

    intro = document.add_paragraph()
    intro.add_run(
        "Ευχαριστούμε. Εφαρμόστηκαν και οι πέντε απαντήσεις. Απομένουν τρία σημεία· "
        "το πρώτο είναι διαφωνία ανάμεσα στον πίνακα που στείλατε και στη γραπτή σας "
        "επιβεβαίωση της ίδιας ημέρας."
    )
    intro.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    applied = document.add_paragraph()
    run = applied.add_run("Τι άλλαξε με βάση τις αποφάσεις σας")
    run.bold, run.font.color.rgb = True, NAVY
    for line in (
        "Η διαλογή ορίστηκε στα €10,00, ως δικό της ποσό και όχι ως μέρος της κλίμακας "
        "60 – 120 – 180.",
        "Ο αριθμός κοστολόγησης συντίθεται πλέον όπως τον επιβεβαιώσατε και αναπαράγει "
        "ακριβώς το υπόδειγμα: OKY1054/0035.",
        "Η προκαταβολή των €100,00 καταγράφεται ξεχωριστά και δεν προστίθεται στο "
        "κόστος, όπως επιβεβαιώσατε.",
        "Ο SHSO-ER16 χωρίστηκε στις τρεις κλίμακες που δώσατε: €50,00 θεραπευτικό "
        "πλύσιμο οργάνου, €120,00 πλύση οφθαλμού τριών ωρών, €200,00 παρουσία "
        "οφθαλμιάτρου. Ο SHSO-ER2 χωρίστηκε ομοίως.",
        "Και οι 48 γραμμές του τιμοκαταλόγου έχουν πλέον δομημένη τιμή. Οι εννέα "
        "γραμμές ελεύθερου κειμένου που είχαμε επισημάνει έκλεισαν.",
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

    path = DOCS / "TAEP_ekkremotites_23092026.docx"
    document.save(path)
    print(f"wrote {path.relative_to(ROOT)}  ({len(ITEMS)} open items)")


if __name__ == "__main__":
    main()
