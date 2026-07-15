"""Δοκιμές εγγραφής σε συνθετικό workbook που μιμείται τη δομή του πραγματικού."""

import pytest
from openpyxl import Workbook, load_workbook

from daspani.excel_write import (
    find_total_row,
    update_control_block,
    update_stoixeia_sheet,
    write_month_sheet,
    write_workbook,
)
from daspani.models import LetterTotals, TableRow


def build_workbook(akas=("100", "200", "300")):
    wb = Workbook()
    ws = wb.active
    ws.title = "ΑΠΡΙΛΙΟΣ"
    ws["A1"] = "ΔΑΠΑΝΗ ΕΙΔΙΚΩΝ ΑΣΤΥΦΥΛΑΚΩΝ"
    headers = ["Α/Α", "Α.Κ.Α.", "Ε/Αστ.", "Ονοματεπώνυμο", "Ημ. Τοποθ.", "Νοσηλ.",
               "Βασικός", "Τιμάριθμος", "Αύξηση", "Βάρδια", "Κυρ/Αργία",
               "Σύνολο", "Εισφορά", "Διοικητικά", "Μερικό", "Γενικό"]
    for c, h in enumerate(headers, 1):
        ws.cell(row=2, column=c).value = h
    for i, aka in enumerate(akas):
        r = 3 + i
        ws.cell(row=r, column=1).value = i + 1
        ws.cell(row=r, column=2).value = aka
        ws.cell(row=r, column=4).value = f"ΥΠΑΛΛΗΛΟΣ {aka}"
        ws.cell(row=r, column=6).value = 1400
        # Φόρμουλες L–P
        ws.cell(row=r, column=12).value = f"=SUM(G{r}:K{r})"
        ws.cell(row=r, column=13).value = f"=L{r}*0.2425"
        ws.cell(row=r, column=14).value = f"=L{r}*0.1"
        ws.cell(row=r, column=15).value = f"=L{r}+M{r}"
        ws.cell(row=r, column=16).value = f"=O{r}+N{r}"
    total = 3 + len(akas)
    ws.cell(row=total, column=1).value = "ΣΥΝΟΛΟ"
    for col in range(7, 17):
        letter = ws.cell(row=3, column=col).column_letter
        ws.cell(row=total, column=col).value = f"=SUM({letter}3:{letter}{total - 1})"
    # Μπλοκ ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ
    block = total + 2
    ws.cell(row=block, column=1).value = "ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ"
    labels = ["Βασικοί Μισθοί", "Τιμαριθμικό Επίδομα", "Αύξηση Μισθού 1,5%",
              "Επίδομα Βάρδιας", "Επίδομα Κυριακής & Δημ. Αργίας",
              "Εισφορά Εργοδότη", "Διοικητικά Έξοδα 10%", "Γενικό Σύνολο"]
    for i, label in enumerate(labels):
        ws.cell(row=block + 1 + i, column=1).value = label
    # Φύλλο ΣΤΟΙΧΕΙΑ_ΕΠΙΣΤΟΛΩΝ
    ws2 = wb.create_sheet("ΣΤΟΙΧΕΙΑ_ΕΠΙΣΤΟΛΩΝ")
    ws2["A1"] = "ΜΗΝΑΣ"
    for c, label in enumerate(labels, 2):
        ws2.cell(row=1, column=c).value = label
    months = ["ΙΑΝΟΥΑΡΙΟΣ", "ΦΕΒΡΟΥΑΡΙΟΣ", "ΜΑΡΤΙΟΣ", "ΑΠΡΙΛΙΟΣ"]
    for r, m in enumerate(months, 2):
        ws2.cell(row=r, column=1).value = m
    return wb


def sample_totals():
    return LetterTotals(basic=3000.0, tim=380.0, auxisi=45.0, bardia=300.0, kyriaki=150.0,
                        eisfora=940.0, dioikitika=390.0, geniko=5205.0,
                        minas_misthon="ΑΠΡΙΛΙΟΣ", etos="2026")


def make_row(aa, aka, basic=1000.0):
    return TableRow(aa=str(aa), aka=aka, name=f"ΥΠΑΛΛΗΛΟΣ {aka}", basic=basic,
                    tim=126.89, auxisi=15.0, bardia=100.0, kyriaki=50.0)


def test_write_matches_by_aka():
    wb = build_workbook()
    ws = wb["ΑΠΡΙΛΙΟΣ"]
    rows = [make_row(1, "100"), make_row(2, "200"), make_row(3, "300")]
    result = write_month_sheet(ws, rows)
    assert result.matched == 3
    assert result.inserted == 0
    assert ws["G3"].value == 1000.0
    assert ws["K5"].value == 50.0
    # Οι φόρμουλες L–P δεν πειράχτηκαν.
    assert ws["L3"].value == "=SUM(G3:K3)"


def test_insert_new_aka_before_total():
    wb = build_workbook()
    ws = wb["ΑΠΡΙΛΙΟΣ"]
    rows = [make_row(1, "100"), make_row(9, "999")]  # το 999 δεν υπάρχει
    result = write_month_sheet(ws, rows)
    assert result.matched == 1
    assert result.inserted == 1
    assert result.unmatched_akas == ["999 ΥΠΑΛΛΗΛΟΣ 999"]
    new_total = find_total_row(ws)
    assert new_total == 7  # η γραμμή ΣΥΝΟΛΟ κατέβηκε κατά μία
    assert ws.cell(row=6, column=2).value == "999"
    # Οι φόρμουλες L–P αντιγράφηκαν μεταφρασμένες στη νέα γραμμή.
    assert ws["L6"].value == "=SUM(G6:K6)"
    # Το εύρος του ΣΥΝΟΛΟΥ επεκτάθηκε ώστε να καλύπτει τη νέα γραμμή.
    assert ws.cell(row=new_total, column=7).value == "=SUM(G3:G6)"


def test_second_row_same_aka_becomes_new_row():
    wb = build_workbook()
    ws = wb["ΑΠΡΙΛΙΟΣ"]
    rows = [make_row(1, "100", basic=1000.0), make_row(2, "100", basic=250.0)]
    result = write_month_sheet(ws, rows)
    assert result.matched == 1
    assert result.inserted == 1
    assert ws["G3"].value == 1000.0
    assert ws["G6"].value == 250.0


def test_idempotent_rerun_on_output(tmp_path):
    wb = build_workbook()
    path = tmp_path / "ΧΡΕΩΣΕΙΣ.xlsx"
    wb.save(path)
    rows = [make_row(1, "100"), make_row(2, "200"), make_row(9, "999")]
    totals = sample_totals()

    result1 = write_workbook(str(path), "ΑΠΡΙΛΙΟΣ", rows, totals)
    out1 = result1.output_path
    assert out1.endswith("ΧΡΕΩΣΕΙΣ_ΑΠΡΙΛΙΟΣ.xlsx")

    # Δεύτερο τρέξιμο πάνω στο παραγόμενο αρχείο: καμία διπλογραφή.
    result2 = write_workbook(out1, "ΑΠΡΙΛΙΟΣ", rows, totals)
    wb2 = load_workbook(result2.output_path)
    ws2 = wb2["ΑΠΡΙΛΙΟΣ"]
    assert result2.inserted == 0
    assert result2.skipped_duplicates == 0  # το 999 πλέον ταιριάζει σε υπάρχουσα γραμμή
    assert result2.matched == 3
    akas = [ws2.cell(row=r, column=2).value for r in range(3, find_total_row(ws2))]
    assert akas.count("999") == 1


def test_control_block_and_stoixeia():
    wb = build_workbook()
    ws = wb["ΑΠΡΙΛΙΟΣ"]
    totals = sample_totals()
    warnings = update_control_block(ws, totals)
    assert warnings == []
    block_row = next(r for r in range(1, ws.max_row + 1) if ws.cell(row=r, column=1).value == "ΕΛΕΓΧΟΣ ΣΥΝΟΛΩΝ")
    assert ws.cell(row=block_row + 1, column=4).value == 3000.0   # Βασικοί -> στήλη D
    assert ws.cell(row=block_row + 8, column=4).value == 5205.0   # Γενικό Σύνολο

    warnings = update_stoixeia_sheet(wb, totals)
    assert warnings == []
    ws2 = wb["ΣΤΟΙΧΕΙΑ_ΕΠΙΣΤΟΛΩΝ"]
    assert ws2.cell(row=5, column=2).value == 3000.0  # γραμμή ΑΠΡΙΛΙΟΣ

    # Δεύτερη κλήση: ο μήνας έχει ήδη τιμές -> δεν αντικαθίστανται.
    totals2 = sample_totals()
    totals2.basic = 9999.0
    warnings = update_stoixeia_sheet(wb, totals2)
    assert any("ήδη τιμές" in w for w in warnings)
    assert ws2.cell(row=5, column=2).value == 3000.0
