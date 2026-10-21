# -*- coding: utf-8 -*-
"""
Builds the Greek questions document for Μονάδα Ελέγχου Εσόδων after the UAT of
21/10/2026.

Only the points the Μονάδα must decide. Defects we can fix ourselves are not here.

    python3 tools/make_uat_questions_doc.py
"""
import csv
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
NAVY = RGBColor(0x1F, 0x38, 0x64)
RED = RGBColor(0xA3, 0x1E, 0x1E)
GREY = RGBColor(0x58, 0x59, 0x5B)

categories = {c["code_new"]: c for c in
              csv.DictReader(open(ROOT / "seed" / "financial_categories.csv",
                                  encoding="utf-8"))}
FEE_CATS = sorted(c for c, r in categories.items()
                  if r["registration_fee_eur"] not in ("", "0.00"))
TARIFF_CATS = sorted(c for c, r in categories.items() if r["tariff_applies"] == "TRUE")

# (heading, paragraphs, what we are asking, lines of answer space, urgent)
ITEMS = [
    ("Τέλος εγγραφής: χρεώνεται ξανά στην έξοδο;",
     "Στις 29/09/2026 μας δώσατε ότι το τέλος εγγραφής των 10 € ισχύει στις "
     "κατηγορίες {fee_cats}. Το εφαρμόσαμε και προστίθεται στο σύνολο της "
     "κοστολόγησης.\n\n"
     "Στη δοκιμή της 21/10 αναφέρθηκε το αντίθετο: ότι το τέλος εισπράττεται ήδη "
     "κατά την εγγραφή του ασθενή, μέσω Medico ή PlanB, και δεν πρέπει να "
     "ξαναχρεώνεται στην έξοδο.\n\n"
     "Τα δύο δεν συμβιβάζονται, και η διαφορά είναι πραγματικά χρήματα σε κάθε "
     "περιστατικό αυτών των κατηγοριών. Δεν αλλάζουμε απόφαση που μας δώσατε "
     "γραπτώς χωρίς νέα απόφαση.\n\n"
     "Και οι δύο λύσεις είναι μικρές σε υλοποίηση. Είτε το τέλος παραμένει στο "
     "σύνολο όπως σήμερα, είτε εμφανίζεται ως ήδη εισπραγμένο και αφαιρείται από "
     "το πληρωτέο, όπως κάνουμε ήδη με την προκαταβολή.",
     "Το τέλος εγγραφής χρεώνεται στην κοστολόγηση εξόδου, ή εισπράττεται "
     "αποκλειστικά κατά την εγγραφή και εμφανίζεται μόνο ενημερωτικά;", 4, True),

    ("Ευρωκάρτα και Βρετανικές Βάσεις: ποια είναι η επιπληρωμή;",
     "Οι κατηγορίες υπάρχουν ήδη: 602 ΕΥΡΩΚΑΡΤΑ και 640 ΒΡΕΤΑΝΙΚΕΣ ΒΑΣΕΙΣ, και "
     "στις δύο ισχύουν οι χρεώσεις τιμοκαταλόγου.\n\n"
     "Αυτό που δεν έχουμε είναι ο κανόνας της επιπληρωμής. Κανείς δεν μας έχει "
     "δώσει ποσοστό, ποσό ή βάση υπολογισμού, και δεν τα υποθέτουμε.\n\n"
     "Χρειαζόμαστε τρία πράγματα για να το προγραμματίσουμε: σε ποιες κατηγορίες "
     "ισχύει, πώς υπολογίζεται, και πάνω σε ποιο ποσό εφαρμόζεται — στο κόστος "
     "βαρύτητας, στις χρεώσεις τιμοκαταλόγου, ή στο σύνολο.",
     "Ποιος είναι ο κανόνας επιπληρωμής για την Ευρωκάρτα και για τις Βρετανικές "
     "Βάσεις, και σε ποια βάση εφαρμόζεται;", 6, True),

    ("Προκαταβολή 100 €: επιβεβαίωση του τρόπου εμφάνισης",
     "Στις 29/09/2026 ορίσατε ότι τα 100 € στην κατηγορία 600 ΕΠΙ ΠΛΗΡΩΜΗ είναι "
     "προκαταβολή και δεν προστίθενται στην κοστολόγηση. Έτσι ακριβώς "
     "υπολογίζεται.\n\n"
     "Στη δοκιμή αναφέρθηκε ότι η προκαταβολή δεν φαινόταν πουθενά. Είχε δίκιο: "
     "την υπολογίζαμε και δεν την εμφανίζαμε. Τώρα τυπώνεται σε δική της γραμμή "
     "κάτω από το τελικό κόστος, μαζί με το υπόλοιπο προς είσπραξη. Το σύνολο δεν "
     "άλλαξε.\n\n"
     "Παράδειγμα από το σύστημα: Τελικό Κόστος 120,00 €, Προκαταβολή 100,00 €, "
     "Υπόλοιπο προς είσπραξη 20,00 €.",
     "Επιβεβαιώνετε ότι η εμφάνιση αυτή είναι σωστή, και ότι το ταμείο εισπράττει "
     "το υπόλοιπο και όχι το τελικό κόστος;", 3, False),

    ("Ποιες μονάδες ΤΑΕΠ βλέπει ο κάθε χρήστης;",
     "Στη δοκιμή αναφέρθηκε ότι εμφανίζονται μόνο δύο μονάδες. Αυτό είναι το "
     "σχεδιασμένο: ο χρήστης βλέπει τις μονάδες του δικού του νοσηλευτηρίου, και "
     "ο λογαριασμός της δοκιμής ανήκει στο Γενικό Νοσοκομείο Λευκωσίας, που "
     "λειτουργεί δύο — ενηλίκων 1054 και παίδων 1106.\n\n"
     "Ο κανόνας αυτός είναι σκόπιμος: καταχωρητής της Λεμεσού δεν πρέπει να βλέπει "
     "ούτε να κοστολογεί περιστατικό της Λευκωσίας.\n\n"
     "Υπάρχει όμως ερώτημα για τους κεντρικούς ρόλους. Στο eFinance, ορισμένοι "
     "ρόλοι βλέπουν ήδη όλα τα νοσηλευτήρια. Αν η Μονάδα θέλει να μπορεί να "
     "καταχωρεί ή να ελέγχει περιστατικά οποιουδήποτε νοσηλευτηρίου, το "
     "προσθέτουμε για αυτούς τους ρόλους και μόνο.",
     "Οι κεντρικοί χρήστες πρέπει να μπορούν να επιλέγουν μονάδα οποιουδήποτε "
     "νοσηλευτηρίου, ή παραμένει ο περιορισμός για όλους;", 3, False),

    ("Διαγνώσεις και ICD-10",
     "Ζητήθηκε πεδίο διάγνωσης με κατάλογο ICD-10. Δεν υπάρχει σήμερα, και δεν "
     "ήταν στην αρχική περιγραφή του έργου.\n\n"
     "Σημειώνουμε ότι η διάγνωση δεν επηρεάζει την τιμή. Ο αλγόριθμος του ΟΑΥ "
     "βγάζει τη βαρύτητα από τις υπηρεσίες που επιλέγονται, όχι από τη διάγνωση. "
     "Άρα το πεδίο είναι για καταγραφή, όχι για κοστολόγηση — κάτι που αλλάζει "
     "πόσο αυστηρά πρέπει να ελέγχεται.\n\n"
     "Για να το φτιάξουμε χρειαζόμαστε τον κατάλογο που θεωρείται επίσημος για "
     "τον ΟΚΥπΥ. Το ICD-10 έχει δεκάδες χιλιάδες κωδικούς και κυκλοφορεί σε "
     "παραλλαγές. Αν υπάρχει ήδη κατάλογος σε χρήση στο Medico ή στο PlanB, "
     "προτιμούμε αυτόν, ώστε οι κωδικοί να ταιριάζουν μεταξύ των συστημάτων.",
     "Είναι υποχρεωτική η διάγνωση για την κοστολόγηση; Και ποιον κατάλογο ICD-10 "
     "χρησιμοποιούμε — υπάρχει αρχείο που μπορείτε να μας δώσετε;", 5, False),

    ("Διόρθωση στοιχείων μετά την καταχώρηση",
     "Αναφέρθηκε ότι δεν γίνεται διόρθωση λάθους στοιχείου. Σωστό, και το "
     "φτιάχνουμε — ο μηχανισμός υπάρχει ήδη, λείπει η οθόνη.\n\n"
     "Πριν το κλειδώσουμε χρειαζόμαστε τον κανόνα. Όσο η κοστολόγηση δεν έχει "
     "οριστικοποιηθεί, η διόρθωση είναι απλή και δεν θίγει τίποτα.\n\n"
     "Μετά την οριστικοποίηση αλλάζει το πράγμα, γιατί έχει εκδοθεί αριθμός "
     "κοστολόγησης και έχει τυπωθεί έγγραφο. Η οικονομική κατηγορία ειδικά "
     "καθορίζει την τιμή: αλλαγή της μετά την οριστικοποίηση σημαίνει άλλο ποσό "
     "από αυτό που έχει ήδη δοθεί στον ασθενή. Για τηλέφωνο ή διεύθυνση δεν "
     "ισχύει το ίδιο.",
     "Μετά την οριστικοποίηση, ποια πεδία επιτρέπεται να διορθωθούν χωρίς ακύρωση "
     "και επανακαταχώρηση, και ποιος έχει το δικαίωμα;", 5, False),

    ("Κατάλογοι θεραπειών και εξετάσεων",
     "Ζητήθηκαν πλήρεις κατάλογοι με δυνατότητα αναζήτησης, ώστε το γραμματειακό "
     "προσωπικό να βρίσκει την πράξη χωρίς ιατρική γνώση. Το φτιάχνουμε.\n\n"
     "Και οι 125 υπηρεσίες έχουν ήδη περιγραφή στα ελληνικά και στα αγγλικά, "
     "οπότε η αναζήτηση θα δέχεται και τα δύο.\n\n"
     "Ένα σημείο θέλει απόφαση: αν η αγγλική περιγραφή πρέπει να φαίνεται δίπλα "
     "στην ελληνική στην οθόνη, ή μόνο να συμμετέχει στην αναζήτηση. Το έντυπο "
     "που παίρνει ο ασθενής παραμένει στα ελληνικά σε κάθε περίπτωση.",
     "Να εμφανίζεται και η αγγλική περιγραφή στην οθόνη επιλογής, ή αρκεί να "
     "λειτουργεί στην αναζήτηση;", 3, False),
]


def answer_box(document, lines):
    """A bordered box with room to write in, instead of a row of dots."""
    table = document.add_table(rows=1, cols=1)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    cell = table.rows[0].cells[0]
    cell.text = ""
    label = cell.paragraphs[0]
    run = label.add_run("Απάντηση Μονάδας Ελέγχου Εσόδων")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(8.5), GREY
    for _ in range(lines):
        blank = cell.add_paragraph("")
        blank.paragraph_format.space_after = Pt(0)
        blank.paragraph_format.line_spacing = 1.6
    document.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


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
    run = paragraph.add_run("Ερωτήματα μετά τη δοκιμή της 21/10/2026")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    meta = document.add_paragraph()
    for label, value in (("Προς: ", "Μονάδα Ελέγχου Εσόδων\n"),
                         ("Από: ", "Τμήμα Πληροφορικής\n"),
                         ("Ημερομηνία: ", "21/10/2026")):
        meta.add_run(label).bold = True
        meta.add_run(value)

    intro = document.add_paragraph()
    intro.add_run(
        "Από τη δοκιμή προέκυψαν οκτώ παρατηρήσεις. Τις πέντε τις διορθώνουμε μόνοι "
        "μας και δεν χρειάζονται απόφαση. Επτά σημεία χρειάζονται τη δική σας "
        "τοποθέτηση, και τα δύο πρώτα αφορούν χρήματα."
    )
    intro.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    done = document.add_paragraph()
    run = done.add_run("Τι διορθώθηκε ήδη, χωρίς να χρειάζεται απόφαση")
    run.bold, run.font.color.rgb = True, NAVY
    for line in (
        "Η προκαταβολή εμφανίζεται πλέον στην οθόνη και στο έντυπο, με το υπόλοιπο "
        "προς είσπραξη από κάτω.",
        "Όλες οι λίστες επιλογής δέχονται πληκτρολόγηση για αναζήτηση. Η Χώρα έχει "
        "257 επιλογές και μέχρι τώρα έβρισκες μόνο με το πρώτο γράμμα.",
        "Η οθόνη διόρθωσης στοιχείων και οι πλήρεις κατάλογοι πράξεων είναι υπό "
        "κατασκευή· τα ερωτήματα 6 και 7 αφορούν τον κανόνα, όχι την υλοποίηση.",
    ):
        bullet = document.add_paragraph(line, style="List Bullet")
        bullet.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        bullet.paragraph_format.space_after = Pt(3)

    document.add_paragraph()
    paragraph = document.add_paragraph()
    run = paragraph.add_run("Ερωτήματα")
    run.bold, run.font.size, run.font.color.rgb = True, Pt(12), NAVY

    fee_cats = ", ".join(FEE_CATS)
    for index, (heading, body, asked, lines, urgent) in enumerate(ITEMS, start=1):
        paragraph = document.add_paragraph()
        run = paragraph.add_run(f"{index}. {heading}")
        run.bold, run.font.size = True, Pt(11)
        run.font.color.rgb = RED if urgent else NAVY

        for block in body.format(fee_cats=fee_cats).split("\n\n"):
            text = document.add_paragraph(block)
            text.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            text.paragraph_format.space_after = Pt(4)

        request = document.add_paragraph()
        run = request.add_run("Ζητούμενο: ")
        run.bold, run.font.color.rgb = True, NAVY
        request.add_run(asked).bold = True

        answer_box(document, lines)
        document.add_paragraph().paragraph_format.space_after = Pt(8)

    closing = document.add_paragraph()
    closing.add_run(
        "Τα ερωτήματα 1 και 2 κρατούν πίσω την παραγωγική λειτουργία, γιατί και τα δύο "
        "καθορίζουν ποσά που θα ζητηθούν από ασθενείς. Τα υπόλοιπα μπορούν να "
        "απαντηθούν παράλληλα με τη δοκιμή."
    )
    closing.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    path = DOCS / "TAEP_erotimata_21102026.docx"
    document.save(path)
    print("wrote %s  (%d questions, %d urgent)"
          % (path.relative_to(ROOT), len(ITEMS),
             sum(1 for i in ITEMS if i[4])))


if __name__ == "__main__":
    main()
