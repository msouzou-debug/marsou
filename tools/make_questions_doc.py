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
    ("Ποσό διαλογής (βαρύτητα 1)",
     "Η απόφασή σας όρισε την κλίμακα 60 – 120 – 180 για τις βαρύτητες 4, 8 και 12. "
     "Για τη διαλογή, όταν δηλαδή ο ασθενής δεν λαμβάνει ούτε διαγνωστική παρέμβαση "
     "ούτε θεραπεία, δεν προκύπτει ποσό από την κλίμακα.\n\n"
     "Το σύστημα δεν υποθέτει τιμή. Κοστολόγηση μόνο διαλογής μπλοκάρεται μέχρι να "
     "καθοριστεί το ποσό.",
     "Ποιο είναι το ποσό για τη διαλογή;", False),

    ("Η προκαταβολή των €100 — χρεώνεται ή πιστώνεται;",
     "Γράψατε ότι οι ασθενείς δεν πληρώνουν τέλη εγγραφής και ότι μόνο η κατηγορία "
     "600 «Επί Πληρωμή» δίνει προκαταβολή €100,00.\n\n"
     "Η προκαταβολή είναι ποσό που καταβάλλεται έναντι του λογαριασμού, όχι χρέωση "
     "που προστίθεται σε αυτόν. Το υλοποιήσαμε έτσι: τα €100,00 καταγράφονται "
     "ξεχωριστά ως προκαταβολή και ΔΕΝ προστίθενται στο τελικό κόστος.\n\n"
     "Αν εννοείτε ότι το ποσό αποτελεί πρόσθετη χρέωση, τότε κάθε κοστολόγηση "
     "«Επί Πληρωμή» υπολείπεται κατά €100,00. Αν το προσθέταμε ενώ πρόκειται για "
     "προκαταβολή, κάθε τέτοιος ασθενής θα χρεωνόταν €100,00 παραπάνω. Επιλέξαμε "
     "την κατεύθυνση που δεν υπερχρεώνει τον ασθενή.\n\n"
     "Σημειώνουμε επίσης ότι οι κατηγορίες 603, 605 και 608 έφεραν €10,00 στο αρχείο "
     "που είχαμε, με σημείωση «πληρώνει όλα τα τέλη εγγραφής». Η απόφασή σας τις "
     "μηδενίζει. Κρατήσαμε και την παλιά τιμή και τη σημείωση ώστε η αλλαγή να "
     "φαίνεται.",
     "Επιβεβαιώστε: προκαταβολή έναντι του λογαριασμού (δεν προστίθεται) ή πρόσθετη "
     "χρέωση (προστίθεται); Και επιβεβαιώστε τον μηδενισμό των 603, 605 και 608.", True),

    ("Ο πίνακας με την αρμόδια αρχή δεν επισυνάφθηκε",
     "Στο θέμα 6 γράψατε «δες πίνακα με οικονομικές κατηγορίες και ποια είναι η "
     "αρμόδια αρχή σε κάθε περίπτωση». Το αρχείο που λάβαμε "
     "(20230706_AE_Catalogue_5.xlsx) περιέχει μόνο τρία φύλλα: Care Levels, "
     "AE Investigation και AE Treatment. Πίνακας οικονομικών κατηγοριών δεν υπάρχει "
     "σε αυτό.\n\n"
     f"Τα πεδία για τον υπόχρεο πληρωμής παραμένουν κενά και στις {VALID_AE} "
     f"κατηγορίες.",
     "Αποστολή του πίνακα με την αρμόδια αρχή ανά οικονομική κατηγορία.", False),

    ("Αριθμός κοστολόγησης — τι γνωρίζουμε",
     "Ζητήσατε περισσότερες πληροφορίες για το ΟΚΥ1054. Όσα έχουμε προέρχονται από "
     "ένα και μόνο υπόδειγμα κοστολόγησης, με αριθμό «OKY1054/0035». Δεν έχουμε "
     "δεύτερο παράδειγμα ούτε κανόνα σύνθεσης.\n\n"
     "Η εικασία μας, χωρίς τεκμηρίωση: «OKY» σταθερό πρόθεμα, «1054» πιθανός κωδικός "
     "νοσηλευτηρίου ή σημείου εξυπηρέτησης, «0035» αύξων αριθμός. Δεν την "
     "υλοποιούμε χωρίς επιβεβαίωση.\n\n"
     "Ανεξάρτητα από τη μορφή, η αρίθμηση θα είναι ανά νοσηλευτήριο, συνεχής και "
     "χωρίς κενά, θα αποδίδεται κατά την οριστικοποίηση και δεν θα "
     "επαναχρησιμοποιείται. Ακυρωμένη κοστολόγηση κρατά τον αριθμό της.",
     "Επιβεβαίωση της σύνθεσης, ή υπόδειξη ποιος στον Οργανισμό γνωρίζει τη μορφή "
     "που χρησιμοποιούν σήμερα τα ΤΑ.ΕΠ.", False),

    ("SHSO-ER16 — σε τι αντιστοιχούν οι τρεις κλίμακες",
     "Δεχθήκαμε την απόφαση να διατηρηθούν όλοι οι κωδικοί και να επιλέγει ο "
     "κωδικοποιητής. Για τον SHSO-ER16 όμως οι τρεις τιμές «50€ / 120€ / 200€» δεν "
     "φέρουν ετικέτα, οπότε ο κωδικοποιητής δεν ξέρει τι επιλέγει.\n\n"
     "Το ίδιο ισχύει και για τον SHSO-ER2, όπου όμως οι τρεις τιμές εξηγούνται από "
     "την περιγραφή (ανά ουσία, πενταπλό, δεκαπλό) και δεν χρειάζεται κάτι άλλο.",
     "Η περιγραφή καθεμιάς από τις τρεις κλίμακες του SHSO-ER16.", False),
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
    run = paragraph.add_run("Εκκρεμότητες μετά τις αποφάσεις της 22/09/2026")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    meta = document.add_paragraph()
    for label, value in (("Προς: ", "Μονάδα Ελέγχου Εσόδων\n"),
                         ("Από: ", "Τμήμα Πληροφορικής\n"),
                         ("Ημερομηνία: ", "22/09/2026")):
        meta.add_run(label).bold = True
        meta.add_run(value)

    intro = document.add_paragraph()
    intro.add_run(
        "Ευχαριστούμε για τις απαντήσεις. Εφαρμόστηκαν όλες. Παρακάτω πέντε σημεία που "
        "προέκυψαν από αυτές — το δεύτερο αφορά €100,00 ανά περιστατικό «Επί Πληρωμή» "
        "και χρειάζεται επιβεβαίωση πριν τεθεί το σύστημα σε λειτουργία."
    )
    intro.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    applied = document.add_paragraph()
    run = applied.add_run("Τι άλλαξε με βάση τις αποφάσεις σας")
    run.bold, run.font.color.rgb = True, NAVY
    for line in (
        f"Ο κατάλογος υπηρεσιών ξαναχτίστηκε από το αρχείο που στείλατε: "
        f"{len(services)} υπηρεσίες. Επιβεβαιώνουμε ότι οι AET085/AET091, "
        f"AET086/AET092 δεν είναι διπλοεγγραφές και ότι δεν λείπει κανένας κωδικός "
        f"θεραπείας — το αρχείο που είχαμε ήταν ελλιπές. Οι σχετικές παρατηρήσεις μας "
        f"αποσύρονται.",
        "Η κοστολόγηση βαρύτητας ακολουθεί την κλίμακα 60 – 120 – 180. Καταργήθηκε η "
        "τιμή μονάδας ανά οικονομική κατηγορία.",
        f"Οι χρεώσεις τιμοκαταλόγου SHSO- ενεργοποιούνται μόνο στις κατηγορίες "
        f"{', '.join(TARIFF_CATS)} και προστίθενται κανονικά. Ο πίνακας των 41 ζευγών "
        f"επικάλυψης καταργήθηκε — η απόφασή σας τον καλύπτει συνολικά.",
        "Οι ελληνικές ετικέτες βαρύτητας λαμβάνονται από το φύλλο «Care Levels» του "
        "καταλόγου, ώστε να μην αποδίδουμε εμείς κείμενο που τυπώνεται σε λογαριασμό.",
        "Τιμοκατάλογος ενιαίος για τα εννέα νοσηλευτήρια. Οι διαγνώσεις ICD-10 "
        "τυπώνονται χωρίς να επηρεάζουν την τιμή.",
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

    path = DOCS / "TAEP_ekkremotites_meta_tis_apofaseis.docx"
    document.save(path)
    print(f"wrote {path.relative_to(ROOT)}  ({len(ITEMS)} open items)")


if __name__ == "__main__":
    main()
