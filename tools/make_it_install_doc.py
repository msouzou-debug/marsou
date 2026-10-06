# -*- coding: utf-8 -*-
"""
Builds the Greek installation instructions for Τμήμα Πληροφορικής.

The unit table and the permission labels are read from the module and the seed data, so
the document cannot drift from what gets installed.

    python3 tools/make_it_install_doc.py
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
GREY = RGBColor(0x44, 0x44, 0x44)

units = list(csv.DictReader(open(ROOT / "seed" / "taep_units.csv", encoding="utf-8")))


def main():
    document = Document()
    style = document.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)
    for section in document.sections:
        section.top_margin = section.bottom_margin = Cm(2)
        section.left_margin = section.right_margin = Cm(2.2)

    def heading(text, size=13):
        p = document.add_paragraph()
        r = p.add_run(text)
        r.bold, r.font.size, r.font.color.rgb = True, Pt(size), NAVY
        return p

    def body(text, bold_lead=None):
        p = document.add_paragraph()
        if bold_lead:
            p.add_run(bold_lead).bold = True
        p.add_run(text)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        return p

    def warn(text, lead="Προσοχή: "):
        p = document.add_paragraph()
        r = p.add_run(lead)
        r.bold, r.font.color.rgb = True, RED
        p.add_run(text)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        return p

    def bullet(text):
        p = document.add_paragraph(text, style="List Bullet")
        p.paragraph_format.space_after = Pt(2)
        return p

    def code(lines):
        for line in lines:
            p = document.add_paragraph()
            r = p.add_run(line or " ")
            r.font.name = "Consolas"
            r.font.size = Pt(9)
            r.font.color.rgb = GREY
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.space_before = Pt(0)
        document.add_paragraph().paragraph_format.space_after = Pt(0)

    def table(headers, rows, widths=None):
        t = document.add_table(rows=1, cols=len(headers))
        t.style = "Table Grid"
        for i, h in enumerate(headers):
            cell = t.rows[0].cells[i]
            cell.text = ""
            r = cell.paragraphs[0].add_run(h)
            r.bold, r.font.size, r.font.color.rgb = True, Pt(9.5), NAVY
        for row in rows:
            cells = t.add_row().cells
            for i, value in enumerate(row):
                cells[i].text = ""
                r = cells[i].paragraphs[0].add_run(str(value))
                r.font.size = Pt(9.5)
        if widths:
            for row in t.rows:
                for i, w in enumerate(widths):
                    row.cells[i].width = Cm(w)
        document.add_paragraph().paragraph_format.space_after = Pt(0)
        return t

    # ---------------------------------------------------------------- title
    heading("Κοστολόγηση Περιστατικών ΤΑ.ΕΠ.", size=16)
    heading("Οδηγίες εγκατάστασης για το Τμήμα Πληροφορικής", size=12)
    body("Το εργαλείο δεν είναι ξεχωριστή εφαρμογή. Είναι module του eFinance, όπως το "
         "boardpack ή το invoices: ένα αρχείο Python που το eFinance φορτώνει κατά την "
         "εκκίνηση και που καταχωρεί μόνο του τους πίνακες και τις οθόνες του. Δεν "
         "χρειάζεται νέος εξυπηρετητής, νέα βάση ούτε νέα υπηρεσία.")
    body("Οι οδηγίες προϋποθέτουν την εγκατάσταση που περιγράφει το ADR-001: Flask, "
         "Gunicorn, MySQL στην παραγωγή, κατάλογος /opt/finance, υπηρεσία "
         "finance.service, θύρα 5004. Αν κάτι από αυτά έχει αλλάξει, ελέγξτε πρώτα το "
         "docs/adr/001-application-stack.md.")

    heading("Πριν αγγίξετε τον εξυπηρετητή")
    warn("μην εκτελέσετε ποτέ το deploy.sh του eFinance. Κάνει "
         "cp -r . /opt/finance/ και γράφει πάνω από το ζωντανό finance.db και το "
         "settings.json. Είναι σενάριο πρώτης εγκατάστασης. Το γράφει και το CLAUDE.md "
         "του eFinance στις πρώτες του γραμμές. Η εγκατάσταση γίνεται αρχείο προς αρχείο.")
    body("Πάρτε αντίγραφο ασφαλείας της βάσης. Το module προσθέτει πίνακες και δεν "
         "πειράζει κανέναν υπάρχοντα, αλλά το αντίγραφο που δεν πήρατε είναι αυτό που "
         "θα χρειαστείτε.")
    body("Δεν χρειάζεται καμία νέα βιβλιοθήκη Python. Ό,τι εισάγει το module κατά την "
         "εκτέλεση — flask, openpyxl, reportlab — βρίσκεται ήδη στο requirements.txt "
         "του eFinance.")

    heading("Βήμα 1 — Αντιγραφή αρχείων")
    body("Από το αποθετήριο marsou, κλάδος claude/new-session-1tcoay, στον κατάλογο "
         "/opt/finance/:")
    code([
        "taep.py",
        "templates/taep_new.html",
        "templates/taep_costing.html",
        "templates/taep_list.html",
        "templates/taep_rates.html",
        "templates/taep_rate_history.html",
        "templates/taep_tariff.html",
        "templates/taep_tariff_diff.html",
        "templates/taep_readiness.html",
        "seed/                      (όλος ο κατάλογος, μαζί με το seed/source/)",
        "tools/check_readiness.py   (ο έλεγχος ετοιμότητας — βλ. Βήμα 5)",
    ])
    body("Ο κατάλογος seed/ πρέπει να ταξιδέψει μαζί με το module: η seed(ctx) διαβάζει "
         "τα αρχεία CSV κατά την εκκίνηση. Το check_readiness.py είναι αυτοτελές — "
         "εισάγει μόνο το taep.py — οπότε τρέχει όπου κι αν το βάλετε.")
    warn("μην αντιγράψετε τα conftest.py, taep_harness.py, test_*.py, acceptance.py "
         "ούτε τα υπόλοιπα αρχεία του tools/. Είναι η πλευρά των δοκιμών και της "
         "παραγωγής εγγράφων· ανήκουν σε σταθμό εργασίας, όχι στον εξυπηρετητή.")

    heading("Βήμα 2 — Δήλωση του module")
    body("Στο /opt/finance/app.py προσθέστε το \"taep\" στον βρόχο _MODULES (κατά τη "
         "σύνταξη του παρόντος, γραμμή 1363):")
    code([
        'for _mod_name in ("boardpack", "vendors", "invoices", "requisitions",',
        '                  "manual", "masterdata", "taep"):',
    ])
    body("Τα bankrec και oayrecon αφαιρέθηκαν από τη λίστα στις 31/07/2026 και οι "
         "πίνακές τους παραμένουν. Μην τα επαναφέρετε με την ευκαιρία.")
    body("Το υπόλοιπο το κάνει το συμβόλαιο του DESIGN.md του eFinance: τα "
         "SCHEMA_STATEMENTS και ALTER_STATEMENTS εκτελούνται μέσα στο κλείδωμα της "
         "init_db (app.py:1453), μετά η seed(ctx) και μετά η register(app, ctx) "
         "(app.py:4283).")

    heading("Βήμα 3 — Καταχώρηση των δικαιωμάτων")
    body("Το PERMISSIONS_CATALOG του eFinance (app.py:718) είναι λεξικό κατηγορία → "
         "λίστα από ζεύγη (κλειδί, ετικέτα). Προσθέτετε δηλαδή μπλοκ, δεν συγχωνεύετε "
         "λεξικό:")
    code(['    "Κοστολόγηση ΤΑΕΠ": ['] +
         ['        ("%s", "%s"),' % (k, v)
          for k, v in taep.PERMISSIONS_CATALOG_EL.items()] +
         ['    ],'])
    warn("όσο τα κλειδιά λείπουν, κάθε οθόνη ΤΑΕΠ απαντά 403. Αυτό είναι σωστό, "
         "αλλά μοιάζει με χαλασμένη εγκατάσταση.", lead="Σημείωση: ")
    body("Τα ονόματα ρόλων της προδιαγραφής (hospital_admin, rates_admin, system_admin) "
         "δεν υπάρχουν στο eFinance. Η αντιστοίχιση που προτείνουμε στους υπαρκτούς "
         "ρόλους — προς έγκριση από τη Μονάδα Ελέγχου Εσόδων, η απόφαση είναι δική "
         "τους:")
    table(["Κλειδί", "Προτεινόμενος ρόλος"],
          [("taep.create", "clerk"),
           ("taep.finalise", "clerk"),
           ("taep.cancel", "admin"),
           ("taep.rates", "chief_accountant"),
           ("taep.admin", "admin")],
          widths=[6.0, 9.0])
    warn("οι CENTRAL_ROLES του eFinance (admin, chief_accountant, cfo, group_cfo, ceo, "
         "board_viewer, fpa, tester) βλέπουν όλες τις οντότητες. Αν δώσετε το "
         "taep.create σε οποιονδήποτε από αυτούς, καταργείται ο κανόνας ότι "
         "καταχωρητής της Λεμεσού δεν βλέπει περιστατικό της Λευκωσίας. Ο ρόλος clerk "
         "δεν είναι κεντρικός, και γι' αυτό είναι το σωστό σπίτι για τα δικαιώματα "
         "κοστολόγησης.")

    heading("Βήμα 4 — Έλεγχος των κωδικών νοσοκομείων")
    body("Το module κλειδώνει κάθε περιστατικό στο entities.code του eFinance. Το "
         "seed/taep_units.csv αντιστοιχίζει κάθε μονάδα ΤΑΕΠ σε οντότητα: NGH, LGH, "
         "LAR, PAP, FAM, CHR, TRD. Αν κάποιος κωδικός διαφέρει σε αυτή την "
         "εγκατάσταση, διορθώστε το CSV πριν την πρώτη εκκίνηση — όχι μετά, γιατί τα "
         "περιστατικά θα έχουν ήδη καταχωρηθεί με λάθος κωδικό.")
    body("Ο Μακάριος ΙΙΙ (ARC) δεν φιλοξενεί μονάδα προς το παρόν, εσκεμμένα. Η "
         "παιδιατρική μονάδα μεταφέρεται εκεί αργότερα· βλ. Βήμα 7.")

    heading("Βήμα 5 — Επανεκκίνηση και έλεγχος του log")
    code(["sudo systemctl restart finance",
          "sudo journalctl -u finance -n 50"])
    body("Περιμένετε τη γραμμή «Module «taep»: routes καταχωρήθηκαν». Αν ένα module "
         "αποτύχει να καταχωρηθεί, το eFinance το γράφει στο log και συνεχίζει "
         "κανονικά — άρα η απουσία της γραμμής είναι ο τρόπος που εκδηλώνεται η "
         "αποτυχία, όχι κάποια κατάρρευση. Ψάξτε τη γραμμή, μην περιμένετε σφάλμα.")

    heading("Βήμα 6 — Έλεγχος ετοιμότητας")
    code(["cd /opt/finance",
          "python3 check_readiness.py                                    # διαβάζει το settings.json",
          "FINANCE_DB=/opt/finance/finance.db python3 check_readiness.py  # ή δηλώνετε το αρχείο SQLite"])
    body("Ο έλεγχος βρίσκει τη βάση όπως τη βρίσκει και το eFinance: settings.json με "
         "db_host σημαίνει MySQL, αλλιώς το τοπικό finance.db. Εναλλακτικά ανοίξτε το "
         "/taep/readiness ως διαχειριστής. Επιστρέφει κωδικό εξόδου διάφορο του μηδενός "
         "σε κάθε εμπόδιο, οπότε μπορεί να μπει σε σενάριο εγκατάστασης.")
    body("Ελέγχει την εγκατάσταση, όχι τον κώδικα: ότι οι πίνακες υπάρχουν, ότι τα "
         "βασικά δεδομένα φορτώθηκαν στα αναμενόμενα πλήθη, ότι ο πίνακας βαρών στη "
         "βάση συμφωνεί ακόμη με τον αλγόριθμο, ότι κάθε βάρος έχει ποσό σε ισχύ, ότι "
         "κανένα τέλος εγγραφής δεν είναι ανεπιβεβαίωτο, ότι καμία περίοδος τιμών δεν "
         "επικαλύπτεται, ότι κάθε μονάδα έχει μοναδικό αριθμό, ότι καμία σειρά "
         "αριθμών κοστολόγησης δεν έχει κενό, και ότι κανένα περιστατικό δεν είναι "
         "οριστικοποιημένο χωρίς αριθμό ή κρατά αριθμό χωρίς να είναι οριστικοποιημένο.")
    warn("μην αφήσετε καταχωρητή να πλησιάσει το εργαλείο πριν ο έλεγχος βγει "
         "καθαρός. Ανεπιβεβαίωτο τέλος εγγραφής είναι εμπόδιο επειδή οι κοστολογήσεις "
         "της κατηγορίας θα αρνηθούν να οριστικοποιηθούν, και το χειρότερο σημείο για "
         "να το ανακαλύψει κανείς είναι μπροστά στον ασθενή.")

    heading("Βήμα 7 — Σταδιακή εφαρμογή ανά μονάδα")
    body("Οκτώ μονάδες σε επτά νοσοκομεία:")
    table(["Αριθμός", "Μονάδα", "Οντότητα"],
          [(u["taep_number"], u["name_el"],
            u["host_entity_code"] + (" (μεταφέρεται σε ARC)"
                                     if u["host_entity_code"] == "NGH"
                                     and u["taep_number"] == "1106" else ""))
           for u in units],
          widths=[2.2, 9.3, 4.5])
    body("Κάθε μονάδα κρατά τη δική της σειρά αριθμών κοστολόγησης, χωρίς κενά. Το "
         "Γενικό Νοσοκομείο Λευκωσίας λειτουργεί δύο μονάδες, οπότε οι καταχωρητές του "
         "επιλέγουν μονάδα στην οθόνη καταχώρησης.")
    warn("ξεκινήστε από μία μονάδα. Η προδιαγραφή απαιτεί δύο εβδομάδες "
         "παράλληλης λειτουργίας με τη σημερινή χειροκίνητη τιμολόγηση σε κάθε "
         "περιστατικό, με διερεύνηση κάθε διαφοράς. Το εργαλείο δεν είναι σωστό εξ "
         "ορισμού. Επεκταθείτε μόνο αφού ένα δεκαπενθήμερο δεν βγάλει καμία "
         "ανεξήγητη διαφορά.", lead="Σειρά: ")
    body("Η μεταφορά του ΤΑΕΠ Παίδων είναι αλλαγή δεδομένων, όχι νέα έκδοση. Όταν η "
         "μονάδα μετακομίσει στον Μακάριο ΙΙΙ, κλείνετε την τρέχουσα γραμμή και "
         "ανοίγετε νέα:")
    code([
        "UPDATE taep_unit SET host_valid_to = '<η προηγούμενη της μεταφοράς>'",
        " WHERE unit_code = 'NIC-PAED' AND host_valid_to IS NULL;",
        "",
        "INSERT INTO taep_unit (unit_code, name_el, taep_number, host_entity_code,",
        "                       host_valid_from, active)",
        "VALUES ('NIC-PAED', 'ΤΑΕΠ Παίδων Λευκωσίας', '1106', 'ARC',",
        "        '<η ημερομηνία μεταφοράς>', 1);",
    ])
    body("Ο αριθμός 1106 και η σειρά του παραμένουν ως έχουν — επιβεβαιώθηκε από τη "
         "Μονάδα Ελέγχου Εσόδων στις 05/10/2026. Τρέξτε τον έλεγχο ετοιμότητας μετά.")

    heading("Βήμα 8 — Αλλαγή τιμής")
    body("Μέσα από το /taep/rates, ποτέ με SQL. Η οθόνη κλείνει την τρέχουσα περίοδο "
         "και ανοίγει την επόμενη, καταγράφει ποιος την άλλαξε και με βάση ποιο "
         "έγγραφο, και αρνείται να γυρίσει πίσω σε κλειστή περίοδο.")
    warn("απευθείας UPDATE στον taep_rate ξαναγράφει το ιστορικό και κάνει μια "
         "παλιά κοστολόγηση μη αναπαραγώγιμη. Η MySQL δεν σας εμποδίζει — ο "
         "περιορισμός αποκλεισμού της PostgreSQL δεν υπάρχει εκεί, και γι' αυτό "
         "υπάρχει η verify_rate_periods() και γι' αυτό η οθόνη τιμών δείχνει τα "
         "ευρήματά της στην κορυφή.")

    heading("Βήμα 9 — Επαναφορά")
    body("Το module προσθέτει πίνακες και δεν αγγίζει κανέναν δικό του το eFinance. Για "
         "να το αποσύρετε:")
    bullet("Αφαιρέστε το \"taep\" από τη λίστα _MODULES στο app.py.")
    bullet("Επανεκκινήστε την υπηρεσία.")
    warn("αφήστε τους πίνακες. Κρατούν εκδοθέντες αριθμούς κοστολόγησης, και ένας "
         "αριθμός δεν επανεκδίδεται ποτέ, ούτε μετά από απόσυρση και επανεγκατάσταση.")

    heading("Τι να παρακολουθείτε τις πρώτες εβδομάδες")
    bullet("Το /taep/readiness μετά από κάθε αλλαγή τιμής και κάθε νέα μονάδα.")
    bullet("Το αρχείο ελέγχου (audit log) για εγγραφές FINALISED χωρίς αντίστοιχη "
           "CALCULATED.")
    bullet("Καταχωρητές που αναφέρουν ότι «εξαφανίστηκε» ένας υπολογισμός. Αυτό είναι ο "
           "κανόνας παλαιότητας που δουλεύει σωστά, όχι βλάβη: αλλαγή υπηρεσίας μετά "
           "τον υπολογισμό σβήνει το αποτέλεσμα, ώστε να μην εμφανιστεί παλιό ποσό.")
    bullet("Κοστολόγηση που αρνείται να οριστικοποιηθεί. Το μήνυμα λέει τι λείπει, και "
           "η απάντηση είναι σχεδόν πάντα μια τιμή που δεν έχει ορίσει ακόμη κανείς.")

    document.add_paragraph()
    p = document.add_paragraph()
    r = p.add_run("Πηγαίος κώδικας: github.com/msouzou-debug/marsou, κλάδος "
                  "claude/new-session-1tcoay. Το παρόν παράγεται από το "
                  "tools/make_it_install_doc.py και το docs/deployment-runbook.md.")
    r.font.size, r.font.color.rgb, r.italic = Pt(8.5), GREY, True

    out = ROOT / "docs" / "TAEP_odigies_egkatastasis_IT.docx"
    document.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
