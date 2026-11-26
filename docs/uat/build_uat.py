# -*- coding: utf-8 -*-
"""Φτιάχνει το βιβλίο εργασίας UAT του eCapital ανά ρόλο.

    /usr/local/bin/python3 docs/uat/build_uat.py

Διαβάζει τα σενάρια από το uat_scenarios.py (ίδιος φάκελος) και γράφει το
docs/uat/eCapital-UAT-ανά-ρόλο-2026-11-26.xlsx. Δεν γράφει κανέναν
υπολογισμένο αριθμό: η «Σύνοψη» μετρά με τύπους από τα φύλλα των ρόλων.
"""
import os
import re
import sys
from datetime import date

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import uat_scenarios as data  # noqa: E402

OUT = os.path.join(HERE, "eCapital-UAT-ανά-ρόλο-2026-11-26.xlsx")
LOGO = os.path.join(HERE, "..", "..", "apps", "web", "public", "brand", "okypy_icon.png")
VERSION = "26/11/2026"

# Χρώματα ΟΚΥπΥ (ARGB) και χρώματα κατάστασης για το «Αποτέλεσμα».
BLUE = "FF069FEC"
BLUE_DEEP = "FF1B75BB"
GREEN = "FF8BC53F"
TEXT = "FF58595B"
LIGHT = "FFEAEAEA"
WHITE = "FFFFFFFF"
PASS_FILL = "FFDCEFC4"
FAIL_FILL = "FFF4CCCC"
BLOCK_FILL = "FFFCE4B6"
NOTRUN_FILL = "FFE3E3E3"

FONT = "Arial"
RESULTS = ["Επιτυχία", "Αποτυχία", "Μπλοκαρισμένο", "Δεν εκτελέστηκε"]

COLUMNS = [
    ("Α/Α", 9),
    ("Περιοχή/Οθόνη", 20),
    ("Σενάριο", 30),
    ("Τύπος", 10),
    ("Προϋποθέσεις", 32),
    ("Βήματα", 58),
    ("Αναμενόμενο αποτέλεσμα", 52),
    ("Νέο", 7),
    ("Αποτέλεσμα", 16),
    ("Ελεγκτής", 16),
    ("Ημερομηνία", 13),
    ("Παρατηρήσεις", 32),
    ("Σημειώσεις συντάκτη", 36),
]
COL = {name: get_column_letter(i + 1) for i, (name, _) in enumerate(COLUMNS)}
HEADER_ROW = 3
FIRST_ROW = HEADER_ROW + 1

thin = Side(style="thin", color=LIGHT)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP_TOP = Alignment(wrap_text=True, vertical="top")
CENTER_TOP = Alignment(horizontal="center", vertical="top", wrap_text=True)


def font(size=10, bold=False, color=TEXT, italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


def header_cells(ws, row, ncols, fill=BLUE_DEEP):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = PatternFill("solid", fgColor=fill)
        cell.font = font(10, True, WHITE)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER


def title_block(ws, title, subtitle, span):
    ws.cell(row=1, column=1, value=title).font = font(15, True, BLUE_DEEP)
    ws.row_dimensions[1].height = 24
    sub = ws.cell(row=2, column=1, value=subtitle)
    sub.font = font(10, False, TEXT, italic=True)
    sub.alignment = Alignment(vertical="center")
    for c in range(1, span + 1):
        ws.cell(row=2, column=c).border = Border(bottom=Side(style="medium", color=BLUE))
    ws.row_dimensions[2].height = 18


def lines_for(text, width):
    """Γραμμές που πιάνει ένα κείμενο με αναδίπλωση σε στήλη πλάτους width."""
    if not text:
        return 1
    per_line = max(1.0, width * 1.15)
    total = 0
    for part in str(text).split("\n"):
        total += max(1, -(-len(part) // int(per_line)))
    return total


def q(sheet):
    """Όνομα φύλλου για αναφορά σε τύπο."""
    return "'" + sheet.replace("'", "''") + "'"


# ---------------------------------------------------------------- έλεγχοι --

ID_RE = re.compile(r"\b(ADM|EST|ENG|TEC|FIN|CLN|TAP|EXE|AUD)-\d{2}\b")
BAD = [("Παρακαλώ", "«Παρακαλώ»"), ("!", "θαυμαστικό"), ("?", "αγγλικό ερωτηματικό"),
       ("Ποινή", "«Ποινή» αντί «Ρήτρα»"), ("ποινή", "«ποινή» αντί «ρήτρα»")]


def check(roles):
    """Μοναδικά Α/Α, σωστό πρόθεμα, συνεχής αρίθμηση, παραπομπές που υπάρχουν."""
    ids = []
    for role in roles:
        if len(role["sheet"]) > 31 or re.search(r"[\[\]:*?/\\]", role["sheet"]):
            raise SystemExit("Μη έγκυρο όνομα φύλλου: " + role["sheet"])
        for n, s in enumerate(role["scenarios"], start=1):
            expected = "%s-%02d" % (role["prefix"], n)
            if s["id"] != expected:
                raise SystemExit("Α/Α %s στη θέση του %s" % (s["id"], expected))
            if s["kind"] not in (data.POS, data.NEG):
                raise SystemExit("Τύπος %s στο %s" % (s["kind"], s["id"]))
            ids.append(s["id"])
    if len(ids) != len(set(ids)):
        raise SystemExit("Διπλά Α/Α")
    known = set(ids)
    texts = []
    for role in roles:
        for s in role["scenarios"]:
            texts.append((s["id"], " ".join([s["area"], s["title"], s["pre"], " ".join(s["steps"]), s["expected"], s["note"]])))
    for name, flow in data.FLOWS:
        texts.append(("ροή " + name, flow))
    for a in data.ASSUMPTIONS:
        texts.append(("παραδοχή " + a[0], " ".join(a)))
    for where, text in texts:
        for ref in (m.group(0) for m in ID_RE.finditer(text)):
            if ref not in known:
                raise SystemExit("Το %s παραπέμπει στο άγνωστο %s" % (where, ref))
        for needle, why in BAD:
            if needle in text:
                raise SystemExit("%s: %s" % (where, why))
    return known


# ---------------------------------------------------------- φύλλα ρόλων --

def role_sheet(wb, role):
    ws = wb.create_sheet(role["sheet"])
    ncols = len(COLUMNS)
    title_block(ws, "eCapital UAT — " + role["sheet"],
                role["about"] + " Έκδοση " + VERSION + ".", ncols)
    for i, (name, width) in enumerate(COLUMNS, start=1):
        ws.cell(row=HEADER_ROW, column=i, value=name)
        ws.column_dimensions[get_column_letter(i)].width = width
    header_cells(ws, HEADER_ROW, ncols)
    ws.row_dimensions[HEADER_ROW].height = 30

    r = FIRST_ROW
    for s in role["scenarios"]:
        steps = "\n".join("%d. %s" % (i, st) for i, st in enumerate(s["steps"], start=1))
        values = [s["id"], s["area"], s["title"], s["kind"], s["pre"], steps, s["expected"],
                  "Ναι" if s["new"] else None, None, None, None, None, s["note"] or None]
        for c, v in enumerate(values, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = font()
            cell.alignment = WRAP_TOP
            cell.border = BORDER
        for name in ("Α/Α", "Τύπος", "Νέο", "Αποτέλεσμα", "Ημερομηνία"):
            ws[COL[name] + str(r)].alignment = CENTER_TOP
        ws[COL["Α/Α"] + str(r)].font = font(10, True, BLUE_DEEP)
        if s["kind"] == data.NEG:
            ws[COL["Τύπος"] + str(r)].font = font(10, True, TEXT)
        if s["new"]:
            ws[COL["Νέο"] + str(r)].font = font(10, True, GREEN)
        ws[COL["Ημερομηνία"] + str(r)].number_format = "dd/mm/yyyy"
        if s["note"]:
            ws[COL["Σημειώσεις συντάκτη"] + str(r)].font = font(9, False, TEXT, italic=True)
        tallest = max(lines_for(v, COLUMNS[c][1]) for c, v in enumerate(values))
        ws.row_dimensions[r].height = min(409, 13 * tallest + 6)
        r += 1
    last = r - 1

    res = "%s%d:%s%d" % (COL["Αποτέλεσμα"], FIRST_ROW, COL["Αποτέλεσμα"], last)
    dv = DataValidation(type="list", formula1='"' + ",".join(RESULTS) + '"', allow_blank=True,
                        showErrorMessage=True, errorTitle="Αποτέλεσμα",
                        error="Επιλέξτε Επιτυχία, Αποτυχία, Μπλοκαρισμένο ή Δεν εκτελέστηκε.",
                        promptTitle="Αποτέλεσμα", prompt="Επιλέξτε από τη λίστα. Κενό σημαίνει ότι δεν εκτελέστηκε.",
                        showInputMessage=True)
    dv.add(res)
    ws.add_data_validation(dv)

    dates = "%s%d:%s%d" % (COL["Ημερομηνία"], FIRST_ROW, COL["Ημερομηνία"], last)
    dvd = DataValidation(type="date", operator="between", formula1="DATE(2026,1,1)", formula2="DATE(2030,12,31)",
                         allow_blank=True, showErrorMessage=True, errorTitle="Ημερομηνία",
                         error="Γράψτε ημερομηνία ηη/μμ/εεεε, από 01/01/2026 έως 31/12/2030.",
                         promptTitle="Ημερομηνία", prompt="Ημερομηνία εκτέλεσης, ηη/μμ/εεεε.", showInputMessage=True)
    dvd.add(dates)
    ws.add_data_validation(dvd)

    for value, colour in zip(RESULTS, (PASS_FILL, FAIL_FILL, BLOCK_FILL, NOTRUN_FILL)):
        ws.conditional_formatting.add(
            res, CellIsRule(operator="equal", formula=['"%s"' % value],
                            fill=PatternFill("solid", fgColor=colour, bgColor=colour)))

    ws.freeze_panes = "%s%d" % (COL["Σενάριο"], FIRST_ROW)
    ws.auto_filter.ref = "A%d:%s%d" % (HEADER_ROW, get_column_letter(ncols), last)
    ws.print_title_rows = "%d:%d" % (HEADER_ROW, HEADER_ROW)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.gridLines = False
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.oddFooter.left.text = "eCapital UAT · " + role["sheet"]
    ws.oddFooter.right.text = "Σελίδα &P από &N"
    ws.sheet_properties.tabColor = BLUE[2:]
    return ws, last


# ---------------------------------------------------------------- Σύνοψη --

def summary_sheet(wb, placed):
    ws = wb.create_sheet("Σύνοψη", 1)
    heads = [("Ρόλος", 34), ("Σύνολο σεναρίων", 11), ("Επιτυχία", 11), ("Αποτυχία", 11),
             ("Μπλοκαρισμένο", 15), ("Δεν εκτελέστηκε", 13), ("% ολοκλήρωσης", 13),
             ("% επιτυχίας επί των εκτελεσμένων", 16), ("Νέα σενάρια", 10), ("Θετικά", 9), ("Αρνήσεις", 10)]
    title_block(ws, "Σύνοψη αποτελεσμάτων ανά ρόλο",
                "Οι αριθμοί υπολογίζονται με τύπους από τη στήλη «Αποτέλεσμα» κάθε φύλλου. Κενό αποτέλεσμα μετρά ως «Δεν εκτελέστηκε». Έκδοση " + VERSION + ".",
                len(heads))
    for i, (h, w) in enumerate(heads, start=1):
        ws.cell(row=HEADER_ROW, column=i, value=h)
        ws.column_dimensions[get_column_letter(i)].width = w
    header_cells(ws, HEADER_ROW, len(heads))
    ws.row_dimensions[HEADER_ROW].height = 44

    r = FIRST_ROW
    for role, (sheet, last) in placed:
        sn = q(sheet)
        ids = "%s!$%s$%d:$%s$%d" % (sn, COL["Α/Α"], FIRST_ROW, COL["Α/Α"], last)
        res = "%s!$%s$%d:$%s$%d" % (sn, COL["Αποτέλεσμα"], FIRST_ROW, COL["Αποτέλεσμα"], last)
        new = "%s!$%s$%d:$%s$%d" % (sn, COL["Νέο"], FIRST_ROW, COL["Νέο"], last)
        kind = "%s!$%s$%d:$%s$%d" % (sn, COL["Τύπος"], FIRST_ROW, COL["Τύπος"], last)
        name = ws.cell(row=r, column=1, value=sheet)
        name.hyperlink = "#%s!A1" % sn
        name.font = font(10, True, BLUE_DEEP)
        ws.cell(row=r, column=2, value="=COUNTA(%s)" % ids)
        ws.cell(row=r, column=3, value='=COUNTIF(%s,"Επιτυχία")' % res)
        ws.cell(row=r, column=4, value='=COUNTIF(%s,"Αποτυχία")' % res)
        ws.cell(row=r, column=5, value='=COUNTIF(%s,"Μπλοκαρισμένο")' % res)
        ws.cell(row=r, column=6, value='=COUNTIF(%s,"Δεν εκτελέστηκε")+COUNTBLANK(%s)' % (res, res))
        ws.cell(row=r, column=7, value="=IFERROR((C{0}+D{0})/B{0},0)".format(r))
        ws.cell(row=r, column=8, value="=IFERROR(C{0}/(C{0}+D{0}),0)".format(r))
        ws.cell(row=r, column=9, value='=COUNTIF(%s,"Ναι")' % new)
        ws.cell(row=r, column=10, value='=COUNTIF(%s,"Θετικό")' % kind)
        ws.cell(row=r, column=11, value='=COUNTIF(%s,"Άρνηση")' % kind)
        r += 1
    last_role = r - 1
    ws.cell(row=r, column=1, value="Σύνολο")
    for c in range(2, len(heads) + 1):
        letter = get_column_letter(c)
        if c in (7, 8):
            continue
        ws.cell(row=r, column=c, value="=SUM(%s%d:%s%d)" % (letter, FIRST_ROW, letter, last_role))
    ws.cell(row=r, column=7, value="=IFERROR((C{0}+D{0})/B{0},0)".format(r))
    ws.cell(row=r, column=8, value="=IFERROR(C{0}/(C{0}+D{0}),0)".format(r))
    total = r

    for row in range(FIRST_ROW, total + 1):
        for c in range(1, len(heads) + 1):
            cell = ws.cell(row=row, column=c)
            cell.border = BORDER
            if c > 1:
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.font = font(10, row == total)
            if c in (7, 8):
                cell.number_format = "0.0%"
            elif c > 1:
                cell.number_format = "#,##0"
    for c in range(1, len(heads) + 1):
        cell = ws.cell(row=total, column=c)
        cell.fill = PatternFill("solid", fgColor=LIGHT)
        cell.font = font(10, True, BLUE_DEEP if c == 1 else TEXT)
        cell.border = Border(top=Side(style="medium", color=BLUE_DEEP), bottom=thin, left=thin, right=thin)

    note_row = total + 2
    notes = [
        "Πώς μετρούν οι στήλες:",
        "«% ολοκλήρωσης» = (Επιτυχία + Αποτυχία) / Σύνολο σεναρίων. Ένα «Μπλοκαρισμένο» δεν θεωρείται εκτελεσμένο.",
        "«% επιτυχίας επί των εκτελεσμένων» = Επιτυχία / (Επιτυχία + Αποτυχία)· 0,0% όσο δεν έχει εκτελεστεί κανένα.",
        "«Νέα σενάρια» = όσα έχουν «Ναι» στη στήλη «Νέο»: αλλαγές από τους γύρους UAT της 25/11/2026 και της 26/11/2026.",
        "Αν προσθέσετε γραμμές σε φύλλο ρόλου, μεγαλώστε τις περιοχές των τύπων ή ξαναφτιάξτε το αρχείο με το build_uat.py.",
    ]
    for i, n in enumerate(notes):
        cell = ws.cell(row=note_row + i, column=1, value=n)
        cell.font = font(10, i == 0)
    ws.freeze_panes = "B%d" % FIRST_ROW
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.sheet_properties.tabColor = GREEN[2:]
    return total


# -------------------------------------------------------------- Οδηγίες --

def instructions_sheet(wb, roles):
    ws = wb.active
    ws.title = "Οδηγίες"
    ws.column_dimensions["A"].width = 36
    for col, w in zip("BCDE", (34, 26, 16, 60)):
        ws.column_dimensions[col].width = w
    title_block(ws, "eCapital — Σενάρια δοκιμών αποδοχής (UAT) ανά ρόλο",
                "Έκδοση " + VERSION + " · Οργανισμός Κρατικών Υπηρεσιών Υγείας (ΟΚΥπΥ) · Τεχνικές Υπηρεσίες", 5)
    if os.path.exists(LOGO):
        try:
            from openpyxl.drawing.image import Image as XLImage
            img = XLImage(LOGO)
            ratio = img.width / img.height
            img.height = 40
            img.width = int(40 * ratio)
            ws.add_image(img, "E1")
        except Exception:  # χωρίς pillow το αρχείο βγαίνει χωρίς λογότυπο
            pass

    row = 4

    def heading(text):
        nonlocal row
        row += 1
        c = ws.cell(row=row, column=1, value=text)
        c.font = font(12, True, BLUE_DEEP)
        row += 1

    def para(text):
        nonlocal row
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=5)
        c = ws.cell(row=row, column=1, value=text)
        c.font = font(10)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[row].height = 13 * lines_for(text, sum(ws.column_dimensions[x].width for x in "ABCDE")) + 4
        row += 1

    def table(heads, rows):
        nonlocal row
        wide = len(heads) == 2
        span = 5 if wide else len(heads)
        for i, h in enumerate(heads, start=1):
            ws.cell(row=row, column=i, value=h)
        header_cells(ws, row, span)
        if wide:
            ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=5)
        row += 1
        for values in rows:
            longest = 1
            for i, v in enumerate(values, start=1):
                c = ws.cell(row=row, column=i, value=v)
                c.font = font(10, i == 1)
                c.alignment = WRAP_TOP
                width = ws.column_dimensions[get_column_letter(i)].width or 10
                if wide and i == 2:
                    width = sum(ws.column_dimensions[x].width for x in "BCDE")
                longest = max(longest, lines_for(v, width * 0.9))
            for i in range(1, span + 1):
                ws.cell(row=row, column=i).border = BORDER
            if wide:
                ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=5)
            ws.row_dimensions[row].height = 13 * longest + 4
            row += 1

    heading("Σκοπός")
    para("Το βιβλίο εργασίας δοκιμάζει το eCapital ανά ρόλο. Κάθε ρόλος έχει δικό του φύλλο με όσα κάνει στην καθημερινή του δουλειά και με όσα δεν πρέπει να μπορεί να κάνει (σενάρια «Άρνηση»). Τα σενάρια ακολουθούν τον πίνακα «Ρόλοι και δικαιώματα» στις προεπιλογές του και τις αλλαγές των γύρων UAT της 25/11/2026 και της 26/11/2026, σημειωμένες με «Ναι» στη στήλη «Νέο».")
    para("Όπου ένα βήμα ανήκει σε ροή με πολλούς ρόλους, κάθε ρόλος έχει το δικό του βήμα στο δικό του φύλλο και οι «Προϋποθέσεις» λένε ποιο σενάριο άλλου φύλλου πρέπει να έχει γίνει πρώτα (π.χ. «ENG-19»).")

    heading("Πώς καταγράφετε ένα αποτέλεσμα")
    para("1. Εκτελέστε τα βήματα με τον λογαριασμό του ρόλου του φύλλου. 2. Στη στήλη «Αποτέλεσμα» επιλέξτε τιμή από τη λίστα. 3. Στη στήλη «Ελεγκτής» γράψτε το όνομα του προσώπου που εκτέλεσε το σενάριο (όχι τον ρόλο «Ελεγκτής»). 4. Στη στήλη «Ημερομηνία» γράψτε την ημέρα εκτέλεσης ηη/μμ/εεεε. 5. Στις «Παρατηρήσεις» γράψτε τι είδατε όταν διαφέρει από το αναμενόμενο, με το ακριβές μήνυμα της οθόνης. Κρατήστε στιγμιότυπο οθόνης για κάθε «Αποτυχία».")
    para("Τη στήλη «Σημειώσεις συντάκτη» τη γράφει ο συντάκτης: λέει από πού βγαίνει το αναμενόμενο αποτέλεσμα ή τι δεν ήταν βέβαιο. Οι αβεβαιότητες είναι συγκεντρωμένες στο φύλλο «Παραδοχές».")
    table(["Τιμή", "Πότε τη χρησιμοποιείτε"], [
        ("Επιτυχία", "Η οθόνη έκανε ό,τι λέει το «Αναμενόμενο αποτέλεσμα». Σε σενάριο «Άρνηση», επιτυχία σημαίνει ότι το σύστημα αρνήθηκε ή δεν πρόσφερε την ενέργεια."),
        ("Αποτυχία", "Το αποτέλεσμα διαφέρει από το αναμενόμενο. Σε σενάριο «Άρνηση», αποτυχία σημαίνει ότι η ενέργεια έγινε ενώ δεν έπρεπε."),
        ("Μπλοκαρισμένο", "Δεν μπορέσατε να εκτελέσετε το σενάριο: λείπει προϋπόθεση, άλλο σενάριο απέτυχε, ή εξωτερικό σύστημα (eFinance, SAP, Outlook) δεν ήταν διαθέσιμο. Γράψτε τον λόγο στις «Παρατηρήσεις»."),
        ("Δεν εκτελέστηκε", "Δεν το δοκιμάσατε ακόμη. Κενό «Αποτέλεσμα» μετρά επίσης ως «Δεν εκτελέστηκε» στη «Σύνοψη»."),
    ])

    heading("Λογαριασμοί δοκιμής")
    para("Ένας λογαριασμός ανά ρόλο στον διακομιστή του ΟΚΥπΥ, που τον δημιουργεί ο Διαχειριστής (ADM-01). Τα ονόματα είναι προτάσεις. Κανένας κωδικός δεν γράφεται σε αυτό το αρχείο, σε e-mail ή σε chat: ο Διαχειριστής τον δίνει από κοντά ή τηλεφωνικά. Τον ρόλο του Ελεγκτή τον δίνει ο διαχειριστής του διακομιστή με την εντολή grant-role.")
    rows = []
    for role in roles:
        rows.append((role["sheet"], role["account"], role["units"], role["prefix"] + "-01 …", role["setup"]))
    table(["Ρόλος (φύλλο)", "Προτεινόμενος λογαριασμός", "Μονάδες", "Σενάρια", "Ρυθμίσεις από τον Διαχειριστή"], rows)

    heading("Δεδομένα δοκιμής")
    para("Κανένα στοιχείο ασθενή δεν χρησιμοποιείται, σε κανένα πεδίο, σημείωση, φωτογραφία ή συνημμένο. Οι φωτογραφίες δεν δείχνουν πρόσωπα. Κάθε e-mail δοκιμής πηγαίνει μόνο σε διεύθυνση του ελεγκτή, ποτέ σε πραγματικό ανάδοχο. Οι εγγραφές που δημιουργούνται έχουν «UAT» στον τίτλο.")
    table(["Όνομα στα σενάρια", "Τι είναι"], data.TEST_DATA)

    heading("Σειρά εκτέλεσης")
    para("Τα φύλλα ακολουθούν τη σειρά των ρόλων του πίνακα «Ρόλοι και δικαιώματα», με τον Διαχειριστή τελευταίο. Η εκτέλεση όμως ξεκινά από την προετοιμασία του Διαχειριστή και ακολουθεί τις ροές:")
    table(["Ροή", "Σενάρια με τη σειρά"], data.FLOWS)

    heading("Μορφές και κανόνες")
    para("Ημερομηνίες ηη/μμ/εεεε (π.χ. 26/11/2026), ώρες Κύπρου. Ποσά 1.234,56 € με το € μετά τον αριθμό. Τα ποσά συμβάσεων, τροποποιήσεων και πιστοποιήσεων είναι «Καθαρό ποσό» με «Συντελεστής ΦΠΑ»· οι προϋπολογισμοί και οι συγκρίσεις κόστους είναι «με ΦΠΑ». Περιηγητής Chrome ή Edge· για τα σενάρια κινητού, κινητό ή παράθυρο στενεμένο στα 390 px. Τα μηνύματα σε εισαγωγικά «…» είναι όπως τα γράφει η οθόνη· μικρές διαφορές διατύπωσης σημειώνονται στις «Παρατηρήσεις» και δεν είναι από μόνες τους αποτυχία.")

    heading("Στήλες των φύλλων ρόλων")
    table(["Στήλη", "Περιεχόμενο"], [
        ("Α/Α", "Κωδικός σεναρίου: ADM, EST, ENG, TEC, FIN, CLN, TAP, EXE, AUD και αύξων αριθμός."),
        ("Περιοχή/Οθόνη", "Το μενού ή η οθόνη όπου γίνεται το σενάριο."),
        ("Τύπος", "«Θετικό»: ο ρόλος κάνει τη δουλειά του. «Άρνηση»: ο ρόλος δεν πρέπει να μπορεί."),
        ("Προϋποθέσεις", "Τι πρέπει να υπάρχει πριν, με παραπομπή σε σενάρια άλλων φύλλων."),
        ("Βήματα", "Αριθμημένα βήματα με τις ετικέτες της οθόνης στα ελληνικά."),
        ("Νέο", "«Ναι» για αλλαγές των γύρων UAT της 25/11/2026 και της 26/11/2026."),
        ("Αποτέλεσμα, Ελεγκτής, Ημερομηνία, Παρατηρήσεις", "Τα συμπληρώνει ο ελεγκτής."),
    ])

    heading("Έκδοση")
    para("Έκδοση " + VERSION + ". Φτιάχνεται με το docs/uat/build_uat.py από τα σενάρια του docs/uat/uat_scenarios.py. Αντικαθιστά, για τον διακομιστή του ΟΚΥπΥ, το docs/uat/UAT-scenarios.el.md της 08/10/2026, που γράφτηκε για τα δείγματα δεδομένων.")

    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.sheet_properties.tabColor = BLUE_DEEP[2:]


# ------------------------------------------------------------ Παραδοχές --

def assumptions_sheet(wb):
    ws = wb.create_sheet("Παραδοχές")
    heads = [("Α/Α", 6), ("Θέμα", 28), ("Παραδοχή ή ανοιχτό σημείο", 80), ("Πηγή", 40), ("Σενάρια", 24)]
    title_block(ws, "Παραδοχές και ανοιχτά σημεία",
                "Όπου ο πίνακας ρόλων και μια οθόνη διαφωνούν, το σενάριο γράφτηκε κατά τον πίνακα και η διαφορά σημειώνεται εδώ.", len(heads))
    for i, (h, w) in enumerate(heads, start=1):
        ws.cell(row=HEADER_ROW, column=i, value=h)
        ws.column_dimensions[get_column_letter(i)].width = w
    header_cells(ws, HEADER_ROW, len(heads))
    r = FIRST_ROW
    for n, (topic, text, source, refs) in enumerate(data.ASSUMPTIONS, start=1):
        for c, v in enumerate((n, topic, text, source, refs), start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = font(10, c == 2)
            cell.alignment = CENTER_TOP if c == 1 else WRAP_TOP
            cell.border = BORDER
        ws.row_dimensions[r].height = 13 * max(lines_for(text, 80), lines_for(source, 40)) + 6
        r += 1
    ws.freeze_panes = "A%d" % FIRST_ROW
    ws.auto_filter.ref = "A%d:E%d" % (HEADER_ROW, r - 1)
    ws.print_title_rows = "%d:%d" % (HEADER_ROW, HEADER_ROW)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.sheet_properties.tabColor = TEXT[2:]


def main():
    roles = data.ROLES
    check(roles)
    wb = Workbook()
    instructions_sheet(wb, roles)
    placed = []
    for role in roles:
        ws, last = role_sheet(wb, role)
        placed.append((role, (ws.title, last)))
    summary_sheet(wb, placed)
    assumptions_sheet(wb)
    # Owner 26/11/2026: «I don't see the scenarios». Open on «Σύνοψη», whose
    # role names link to each role's sheet, so the scenarios are one click away.
    summary = wb["Σύνοψη"]
    wb.active = wb.worksheets.index(summary)
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws is summary
    wb.properties.title = "eCapital UAT ανά ρόλο"
    wb.calculation.fullCalcOnLoad = True  # το Excel υπολογίζει τη «Σύνοψη» μόλις ανοίξει
    wb.properties.creator = "ΟΚΥπΥ Τεχνικές Υπηρεσίες"
    wb.save(OUT)
    total = sum(len(r["scenarios"]) for r in roles)
    print("Γράφτηκε %s: %d σενάρια σε %d φύλλα ρόλων." % (os.path.relpath(OUT), total, len(roles)))
    for r in roles:
        print("  %-34s %3d" % (r["sheet"], len(r["scenarios"])))


if __name__ == "__main__":
    main()
