from daspani.claude_extract import merge_rows
from daspani.models import LetterTotals, TableRow
from daspani.verify import all_ok, column_checks, consistency_checks


def make_row(aa, aka, basic, bardia=100.0, kyriaki=50.0):
    auxisi = round(basic * 0.015, 2)
    tim = round((basic + auxisi) * 0.1267, 2)
    return TableRow(aa=str(aa), aka=aka, name=f"ΟΝΟΜΑ {aa}",
                    basic=basic, tim=tim, auxisi=auxisi, bardia=bardia, kyriaki=kyriaki)


def test_merge_rows_dedupes_overlap():
    r1 = make_row(1, "111", 1000.0)
    r2 = make_row(2, "222", 1200.0)
    r2_dup = make_row(2, "222", 1200.0)  # ίδια γραμμή από την επικάλυψη των δύο μισών
    r3 = make_row(3, "333", 900.0)
    merged = merge_rows([[r1, r2], [r2_dup, r3]])
    assert [r.aa for r in merged] == ["1", "2", "3"]


def test_merge_keeps_second_row_of_same_aka_with_different_amounts():
    r1 = make_row(1, "111", 1000.0)
    r1b = make_row(2, "111", 250.0)  # αναλογία, ίδιο ΑΚΑ, άλλα ποσά
    merged = merge_rows([[r1], [r1b]])
    assert len(merged) == 2


def test_column_checks_ok_and_diff():
    rows = [make_row(1, "111", 1000.0), make_row(2, "222", 2000.0)]
    totals = LetterTotals(
        basic=3000.0,
        tim=sum(r.tim for r in rows),
        auxisi=sum(r.auxisi for r in rows),
        bardia=200.0,
        kyriaki=100.0,
    )
    checks = column_checks(rows, totals)
    assert all_ok(checks)

    totals.basic = 3000.10  # εκτός ανοχής ±0,05
    checks = column_checks(rows, totals)
    assert not all_ok(checks)
    bad = next(c for c in checks if c.field == "basic")
    assert bad.diff == -0.10


def test_consistency_checks_flags_bad_rows():
    good = make_row(1, "111", 1000.0)
    bad = make_row(2, "222", 1000.0)
    bad.tim = 999.99
    analogia = TableRow(aa="3", aka="333", name="ΑΝΑΛΟΓΙΑ ΜΙΣΘΟΥ Χ", basic=500.0, tim=1.0)
    consistency_checks([good, bad, analogia])
    assert not good.needs_review
    assert bad.needs_review
    assert not analogia.needs_review  # οι αναλογικές εξαιρούνται
