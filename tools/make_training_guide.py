# -*- coding: utf-8 -*-
"""
Builds the Greek clerk training guide.

Figures and examples are read from the seed data, so the guide cannot drift from the
system it documents.

    python3 tools/make_training_guide.py
"""
import csv
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import taep   # noqa: E402

NAVY = RGBColor(0x1F, 0x38, 0x64)
RED = RGBColor(0xA3, 0x1E, 0x1E)

categories = list(csv.DictReader(open(ROOT / "seed" / "financial_categories.csv",
                                      encoding="utf-8")))
units = list(csv.DictReader(open(ROOT / "seed" / "taep_units.csv", encoding="utf-8")))
services = list(csv.DictReader(open(ROOT / "seed" / "services.csv", encoding="utf-8")))
VALID = [c for c in categories if c["valid_for_ae"] == "TRUE"]
TARIFF_CATS = [c for c in categories if c["tariff_applies"] == "TRUE"]
FEE_CATS = [c for c in categories if c["registration_fee_eur"] not in ("0.00", "")]


def main():
    document = Document()
    style = document.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)
    for section in document.sections:
        section.top_margin = section.bottom_margin = Cm(2)
        section.left_margin = section.right_margin = Cm(2.2)

    def heading(text, size=13):
        paragraph = document.add_paragraph()
        run = paragraph.add_run(text)
        run.bold, run.font.size, run.font.color.rgb = True, Pt(size), NAVY
        return paragraph

    def body(text, bold_lead=None):
        paragraph = document.add_paragraph()
        if bold_lead:
            paragraph.add_run(bold_lead).bold = True
        paragraph.add_run(text)
        paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        return paragraph

    def bullet(text):
        paragraph = document.add_paragraph(text, style="List Bullet")
        paragraph.paragraph_format.space_after = Pt(2)
        return paragraph

    paragraph = document.add_paragraph()
    run = paragraph.add_run("Κοστολόγηση Περιστατικών ΤΑ.ΕΠ.")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(16), NAVY
    paragraph = document.add_paragraph()
    run = paragraph.add_run("Οδηγός χρήσης για τον κωδικοποιητή")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    body("Το εργαλείο κάνει ένα πράγμα: μετατρέπει τις υπηρεσίες που σημειώθηκαν "
         "στο έντυπο ΟΚΥπΥ 1-125 σε τιμή που μπορεί να υποστηριχθεί. Δεν αντικαθιστά "
         "το σύστημα ασθενών και δεν εισπράττει.")

    heading("Τι κάνετε, με τη σειρά", 12)
    for step in (
        "Καταχωρείτε τα στοιχεία ταυτοποίησης του ασθενούς.",
        "Συμπληρώνετε τα προσωπικά στοιχεία και τα στοιχεία του περιστατικού.",
        "Επιλέγετε την οικονομική κατηγορία.",
        "Επιλέγετε τις υπηρεσίες που σημείωσε ο ιατρός στο έντυπο.",
        "Πατάτε «Υπολογισμός».",
        "Πατάτε «Οριστικοποίηση» και εκτυπώνετε.",
    ):
        paragraph = document.add_paragraph(step, style="List Number")
        paragraph.paragraph_format.space_after = Pt(2)
    body("Ο στόχος είναι κάτω από 90 δευτερόλεπτα για ένα συνηθισμένο περιστατικό. "
         "Η αναζήτηση υπηρεσιών δουλεύει με το πληκτρολόγιο: γράφετε, πατάτε Enter, "
         "γράφετε την επόμενη.")

    heading("1. Ταυτοποίηση — πρώτα αυτή", 12)
    body("Ο αριθμός ταυτοποίησης μπαίνει πρώτος, επειδή με βάση αυτόν το σύστημα "
         "ψάχνει προηγούμενες καταχωρήσεις. Αν δεν βρεθεί τίποτα, δεν αλλάζει τίποτα "
         "στην οθόνη — αυτή είναι η συνηθισμένη περίπτωση.")
    bullet("Αν βρεθούν προηγούμενες καταχωρήσεις, εμφανίζεται κουμπί «Συμπλήρωση "
           "στοιχείων». Συμπληρώνει μόνο αν το πατήσετε.")
    paragraph = document.add_paragraph(style="List Bullet")
    run = paragraph.add_run("Αν υπάρχει προηγούμενη κοστολόγηση «Επί Πληρωμή» χωρίς "
                            "καταγεγραμμένη εξόφληση, εμφανίζεται κόκκινη ειδοποίηση. ")
    run.font.color.rgb = RED
    paragraph.add_run("Δεν σας εμποδίζει να συνεχίσετε. Είναι η μόνη στιγμή που ο "
                      "Οργανισμός μπορεί να ζητήσει αυτά τα χρήματα.")
    body("Ληγμένο έγγραφο ταυτοποίησης δίνει προειδοποίηση, όχι σφάλμα. Σε αυτόν τον "
         "πληθυσμό είναι συχνό και δεν εμποδίζει την καταχώρηση.")

    heading("2. Οικονομική κατηγορία — εδώ κρίνεται η τιμή", 12)
    body(f"Ο κατάλογος προσφέρει {len(VALID)} κατηγορίες, όχι {len(categories)}. "
         f"Οι υπόλοιπες δεν μπορούν να προκύψουν από περιστατικό ΤΑΕΠ "
         f"(οδοντιατρικές υπηρεσίες, δωρεά οργάνων, προγράμματα ανίχνευσης) και "
         f"γι' αυτό δεν εμφανίζονται καθόλου.")
    body("Γράφετε είτε τον κωδικό είτε το όνομα: και το «624» και το «ασυλ» βρίσκουν "
         "την ίδια κατηγορία. Λάθος κατηγορία σημαίνει λάθος τιμή σε όλο το "
         "περιστατικό, οπότε αξίζει ο δεύτερος έλεγχος.")
    body(f"Τρεις κατηγορίες επιτρέπουν πρόσθετες χρεώσεις τιμοκαταλόγου: "
         f"{', '.join(c['code_new'] + ' ' + c['name_el'] for c in TARIFF_CATS)}. "
         f"Στις υπόλοιπες οι χρεώσεις αυτές δεν ισχύουν και το σύστημα τις απορρίπτει.")
    body(f"Τέλος εγγραφής χρεώνεται μόνο στις κατηγορίες "
         f"{', '.join(c['code_new'] for c in FEE_CATS)} (€10,00). Η κατηγορία 600 "
         f"«Επί Πληρωμή» δίνει προκαταβολή €100,00 που ΔΕΝ προστίθεται στο κόστος.")

    heading("3. Μονάδα ΤΑΕΠ", 12)
    body("Το Γενικό Νοσοκομείο Λευκωσίας λειτουργεί δύο μονάδες, ενηλίκων και παίδων, "
         "με χωριστή αρίθμηση κοστολογήσεων. Επιλέγετε τη σωστή. Αν επιλεγεί λάθος, "
         "η διόρθωση γίνεται μόνο με ακύρωση και νέα καταχώρηση, γιατί ο αριθμός "
         "κοστολόγησης έχει ήδη αποδοθεί.")

    heading("4. Επιλογή υπηρεσιών", 12)
    body(f"Η αναζήτηση καλύπτει και τις {len(services)} υπηρεσίες μαζί, θεραπείες και "
         f"διαγνωστικές παρεμβάσεις, επειδή διαβάζετε το έντυπο με τη σειρά που το "
         f"συμπλήρωσε ο ιατρός και όχι με τη σειρά του συστήματος.")
    bullet("Δεν έχει σημασία αν γράφετε με τόνους, χωρίς τόνους, κεφαλαία ή πεζά: "
           "«ΕΓΧΥΣΗ ΥΓΡΩΝ», «εγχυση υγρων» και «Έγχυση υγρών» βρίσκουν το ίδιο.")
    bullet("Μπορείτε να γράψετε και τον κωδικό απευθείας, π.χ. AET043.")
    bullet("Η κατηγορία κάθε υπηρεσίας φαίνεται δίπλα της. Η υψηλότερη κατηγορία κάθε "
           "πλευράς καθορίζει την τιμή — όχι το πλήθος των υπηρεσιών.")
    body("Αν επιλέξετε υπηρεσίες, χρειάζονται και οι δύο πλευρές: τουλάχιστον μία "
         "διαγνωστική παρέμβαση και τουλάχιστον μία θεραπεία. Υπάρχουν οι κωδικοί "
         "«Καμία» (AED004, AET021) ακριβώς για να καταγραφεί ότι δεν έγινε κάτι στη "
         "μία πλευρά.")
    body("Αν δεν επιλέξετε καμία υπηρεσία, το περιστατικό χρεώνεται ως Διαλογή, "
         "€10,00. Αυτό το λέει η οθόνη πριν υπολογίσετε.")

    heading("5. Υπολογισμός", 12)
    body("Ο υπολογισμός γίνεται μόνο όταν τον ζητήσετε. Το σύστημα δεν "
         "επανυπολογίζει μόνο του σε κάθε επιλογή, ώστε το ποσό να αλλάζει επειδή το "
         "ζητήσατε.")
    scale_rows = [(4, "60,00"), (8, "120,00"), (12, "180,00")]
    table = document.add_table(rows=1, cols=3)
    table.style = "Table Grid"
    for cell, label in zip(table.rows[0].cells,
                           ("Βαρύτητα", "Κατηγοριοποίηση", "Ποσό")):
        cell.text = ""
        cell.paragraphs[0].add_run(label).bold = True
    for weight, amount in scale_rows:
        row = table.add_row().cells
        row[0].text = str(weight)
        row[1].text = taep.BAND_LABELS_EL[weight]
        row[2].text = f"€{amount}"
    row = table.add_row().cells
    row[0].text = "1"
    row[1].text = "Διαλογή"
    row[2].text = "€10,00"

    document.add_paragraph()
    paragraph = document.add_paragraph()
    run = paragraph.add_run("Αν αλλάξετε υπηρεσία μετά τον υπολογισμό, το αποτέλεσμα "
                            "σβήνει και πρέπει να υπολογίσετε ξανά. ")
    run.bold = True
    paragraph.add_run("Αυτό δεν είναι βλάβη. Προστατεύει από το να εκτυπωθεί ποσό που "
                      "δεν αντιστοιχεί στις υπηρεσίες που φαίνονται στην οθόνη.")

    heading("6. Οριστικοποίηση και εκτύπωση", 12)
    body("Η οριστικοποίηση αποδίδει τον αριθμό κοστολόγησης και κλειδώνει την "
         "καταχώρηση. Μετά από αυτό δεν τροποποιείται τίποτα: η διόρθωση γίνεται με "
         "ακύρωση και νέα καταχώρηση, και η ακύρωση ζητά αιτιολογία.")
    body("Ο αριθμός έχει τη μορφή OKY<κωδικός μονάδας>/<αύξων αριθμός>, π.χ. "
         "OKY1054/0035. Κάθε μονάδα έχει δική της συνεχή σειρά. Ακυρωμένη "
         "κοστολόγηση κρατά τον αριθμό της και αυτός δεν δίνεται ποτέ σε άλλη.")

    heading("Τι σημαίνουν τα μηνύματα", 12)
    messages = [
        ("«Δεν έχει επιλεγεί καμία θεραπεία»",
         "Επιλέξατε μόνο διαγνωστικές παρεμβάσεις. Χρειάζονται και οι δύο πλευρές."),
        ("«Οι υπηρεσίες άλλαξαν»",
         "Αλλάξατε κάτι μετά τον υπολογισμό. Πατήστε «Υπολογισμός» ξανά."),
        ("«Δεν έχει καθοριστεί το ποσό…»",
         "Λείπει τιμή για αυτή την κατηγορία ή βαρύτητα. Δεν είναι δικό σας λάθος — "
         "ενημερώστε τη Μονάδα Ελέγχου Εσόδων. Το σύστημα αρνείται να υποθέσει τιμή."),
        ("«Οι πρόσθετες χρεώσεις δεν ισχύουν για την οικονομική κατηγορία…»",
         "Οι χρεώσεις τιμοκαταλόγου ισχύουν μόνο στις τρεις κατηγορίες που πληρώνει "
         "ο ίδιος ο ασθενής."),
        ("«Η καταχώρηση έχει ήδη οριστικοποιηθεί»",
         "Η κοστολόγηση έχει κλειδώσει. Για διόρθωση απαιτείται ακύρωση από "
         "διαχειριστή."),
        ("«Η ώρα εξέτασης δεν μπορεί να προηγείται της ώρας εισαγωγής»",
         "Ελέγξτε τις ώρες στο έντυπο. Η σειρά είναι εισαγωγή, εξέταση, εξιτήριο."),
    ]
    table = document.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    for cell, label in zip(table.rows[0].cells, ("Μήνυμα", "Τι κάνετε")):
        cell.text = ""
        cell.paragraphs[0].add_run(label).bold = True
    for message, action in messages:
        row = table.add_row().cells
        row[0].text = message
        row[1].text = action
    for row in table.rows:
        row.cells[0].width = Cm(6.5)
        row.cells[1].width = Cm(10)

    document.add_page_break()
    heading("Τα δύο λάθη που κοστίζουν", 12)
    body("Λάθος οικονομική κατηγορία. Τιμολογεί λάθος όλο το περιστατικό και "
         "διορθώνεται μόνο με ακύρωση. Ελέγξτε την πριν τον υπολογισμό.",
         bold_lead="1. ")
    body("Λάθος μονάδα ΤΑΕΠ στη Λευκωσία. Ο αριθμός κοστολόγησης βγαίνει από λάθος "
         "σειρά και δεν διορθώνεται εκ των υστέρων.", bold_lead="2. ")

    heading("Πού να απευθυνθείτε", 12)
    bullet("Λείπει τιμή ή τέλος εγγραφής → Μονάδα Ελέγχου Εσόδων.")
    bullet("Λάθος ή διπλή υπηρεσία στον κατάλογο → Μονάδα Ελέγχου Εσόδων.")
    bullet("Η οθόνη δεν φορτώνει, δεν εκτυπώνεται, σφάλμα συστήματος → "
           "Τμήμα Πληροφορικής.")
    bullet("Ακύρωση οριστικοποιημένης κοστολόγησης → ο διαχειριστής του "
           "νοσηλευτηρίου.")

    document.add_paragraph()
    note = document.add_paragraph()
    run = note.add_run(
        "Κατά τις πρώτες δύο εβδομάδες κάθε περιστατικό κοστολογείται και με το χέρι, "
        "όπως γινόταν μέχρι τώρα, και οι δύο τιμές συγκρίνονται. Κάθε διαφορά "
        "εξετάζεται. Αν δείτε διαφορά, αναφέρετέ τη — το εργαλείο δεν θεωρείται σωστό "
        "εξ ορισμού.")
    run.italic = True
    note.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    path = ROOT / "docs" / "TAEP_odigos_kodikopoiiti.docx"
    document.save(path)
    print(f"wrote {path.relative_to(ROOT)}")
    print(f"  {len(VALID)} valid categories, {len(services)} services, "
          f"{len(units)} units, {len(messages)} messages explained")


if __name__ == "__main__":
    main()
